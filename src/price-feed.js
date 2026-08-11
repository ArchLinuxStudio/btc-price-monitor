const ASSETS = ["BTC", "ETH"];
const STALE_AFTER_MS = 12_000;
const PRIMARY_PREFERENCE_MS = 5_000;
const REST_FALLBACK_INTERVAL_MS = 5_000;
const REST_ENDPOINTS = {
  BTC: "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
  ETH: "https://api.exchange.coinbase.com/products/ETH-USD/ticker",
};

const SOURCES = [
  {
    id: "coinbase",
    label: "Coinbase",
    url: "wss://advanced-trade-ws.coinbase.com",
    subscriptions: [
      {
        type: "subscribe",
        product_ids: ["BTC-USD", "ETH-USD"],
        channel: "ticker",
      },
      { type: "subscribe", channel: "heartbeats" },
    ],
    parser: parseCoinbaseMessage,
    idleTimeoutMs: 10_000,
    quoteTimeoutMs: 20_000,
    assets: ["BTC", "ETH"],
  },
  {
    id: "kraken",
    label: "Kraken",
    url: "wss://ws.kraken.com/v2",
    subscriptions: [
      {
        method: "subscribe",
        params: {
          channel: "ticker",
          symbol: ["BTC/USD", "ETH/USD"],
          event_trigger: "trades",
          snapshot: true,
        },
        req_id: 1,
      },
    ],
    parser: parseKrakenMessage,
    idleTimeoutMs: 10_000,
    quoteTimeoutMs: 20_000,
    assets: ["BTC", "ETH"],
    pingMessage: () => ({ method: "ping", req_id: Date.now() % 2_147_483_647 }),
  },
];

function parseJson(raw) {
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    if (raw instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(raw));
    }
    if (ArrayBuffer.isView(raw)) {
      return JSON.parse(new TextDecoder().decode(raw));
    }
  } catch {
    return null;
  }
  return null;
}

function finiteNumber(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function positivePrice(value) {
  const result = finiteNumber(value);
  return result !== null && result > 0 ? result : null;
}

function timestamp(value, fallback) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseCoinbaseMessage(raw, receivedAt = Date.now()) {
  const message = parseJson(raw);
  if (!message || message.channel !== "ticker" || !Array.isArray(message.events)) {
    return [];
  }

  const exchangeAt = timestamp(message.timestamp, receivedAt);
  const quotes = [];

  for (const event of message.events) {
    if (!event || !Array.isArray(event.tickers)) continue;

    for (const ticker of event.tickers) {
      const asset = ticker.product_id === "BTC-USD"
        ? "BTC"
        : ticker.product_id === "ETH-USD"
          ? "ETH"
          : null;
      const price = positivePrice(ticker.price);
      if (!asset || price === null) continue;

      quotes.push({
        asset,
        price,
        change24h: finiteNumber(ticker.price_percent_chg_24_h),
        source: "coinbase",
        sourceLabel: "Coinbase",
        exchangeAt,
        receivedAt,
      });
    }
  }

  return quotes;
}

export function parseKrakenMessage(raw, receivedAt = Date.now()) {
  const message = parseJson(raw);
  if (!message || message.channel !== "ticker" || !Array.isArray(message.data)) {
    return [];
  }

  const quotes = [];
  for (const ticker of message.data) {
    const asset = ticker.symbol === "BTC/USD"
      ? "BTC"
      : ticker.symbol === "ETH/USD"
        ? "ETH"
        : null;
    const price = positivePrice(ticker.last);
    if (!asset || price === null) continue;

    quotes.push({
      asset,
      price,
      change24h: finiteNumber(ticker.change_pct),
      source: "kraken",
      sourceLabel: "Kraken",
      exchangeAt: timestamp(ticker.timestamp, receivedAt),
      receivedAt,
    });
  }

  return quotes;
}

export function parseRestTicker(asset, payload, receivedAt = Date.now()) {
  if (!ASSETS.includes(asset) || !payload || typeof payload !== "object") return null;
  const price = positivePrice(payload.price);
  if (price === null) return null;
  return {
    asset,
    price,
    change24h: null,
    source: "coinbaseRest",
    sourceLabel: "Coinbase REST",
    exchangeAt: timestamp(payload.time, receivedAt),
    receivedAt,
  };
}

export function reconnectDelay(attempt, random = Math.random) {
  const exponent = Math.min(Math.max(0, attempt), 6);
  const base = Math.min(500 * (2 ** exponent), 30_000);
  const jitter = 0.75 + random() * 0.5;
  return Math.round(base * jitter);
}

export function selectQuote(sourceQuotes, now = Date.now()) {
  const quotes = Object.values(sourceQuotes || {}).filter(Boolean);
  if (quotes.length === 0) return null;

  const coinbase = sourceQuotes.coinbase;
  if (coinbase && now - coinbase.receivedAt <= PRIMARY_PREFERENCE_MS) {
    return { ...coinbase, stale: false };
  }

  const fresh = quotes
    .filter((quote) => now - quote.receivedAt <= STALE_AFTER_MS)
    .sort((a, b) => b.receivedAt - a.receivedAt);
  if (fresh.length > 0) return { ...fresh[0], stale: false };

  const newest = quotes.sort((a, b) => b.receivedAt - a.receivedAt)[0];
  return { ...newest, stale: true };
}

class ResilientSocket {
  constructor(config, WebSocketImpl, handlers) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.handlers = handlers;
    this.socket = null;
    this.status = "idle";
    this.stopped = true;
    this.reconnectAttempt = 0;
    this.lastMessageAt = 0;
    this.openedAt = 0;
    this.lastQuoteAt = Object.fromEntries(config.assets.map((asset) => [asset, 0]));
    this.openTimer = null;
    this.watchdogTimer = null;
    this.reconnectTimer = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) {
      try {
        socket.close(1000, "monitor stopped");
      } catch {
        // The browser may reject close() while the handshake is still pending.
      }
    }
    this.setStatus("idle");
  }

  reconnectNow() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    if (socket && socket.readyState < 2) {
      try {
        socket.close(4001, "manual reconnect");
        return;
      } catch {
        // Fall through and open a fresh socket.
      }
    }
    if (socket && socket.readyState === 2) return;
    this.connect();
  }

  connect() {
    if (this.stopped || this.socket) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    let socket;
    try {
      socket = new this.WebSocketImpl(this.config.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.openTimer = setTimeout(() => {
      if (socket === this.socket && socket.readyState !== 1) {
        try { socket.close(); } catch { /* no-op */ }
        this.socket = null;
        this.scheduleReconnect();
      }
    }, 12_000);

    socket.addEventListener("open", () => {
      if (socket !== this.socket || this.stopped) return;
      clearTimeout(this.openTimer);
      this.openTimer = null;
      this.lastMessageAt = Date.now();
      this.openedAt = this.lastMessageAt;
      for (const asset of this.config.assets) this.lastQuoteAt[asset] = 0;
      this.setStatus("open");

      for (const subscription of this.config.subscriptions) {
        socket.send(JSON.stringify(subscription));
      }

      this.watchdogTimer = setInterval(() => {
        if (socket !== this.socket || socket.readyState !== 1) return;
        const idleFor = Date.now() - this.lastMessageAt;
        if (idleFor > this.config.idleTimeoutMs) {
          try { socket.close(4000, "feed timeout"); } catch { /* no-op */ }
          return;
        }
        const missingQuotes = this.config.assets.some((asset) => {
          const lastQuoteAt = this.lastQuoteAt[asset] || this.openedAt;
          return Date.now() - lastQuoteAt > this.config.quoteTimeoutMs;
        });
        if (missingQuotes) {
          try { socket.close(4002, "ticker timeout"); } catch { /* no-op */ }
          return;
        }
        if (this.config.pingMessage) {
          socket.send(JSON.stringify(this.config.pingMessage()));
        }
      }, 5_000);
    });

    socket.addEventListener("message", (event) => {
      if (socket !== this.socket || this.stopped) return;
      this.lastMessageAt = Date.now();
      const quotes = this.config.parser(event.data, this.lastMessageAt);
      if (quotes.length > 0) {
        this.reconnectAttempt = 0;
        for (const quote of quotes) this.lastQuoteAt[quote.asset] = this.lastMessageAt;
        this.handlers.onQuotes(quotes);
      }
    });

    socket.addEventListener("error", () => {
      if (socket !== this.socket || this.stopped) return;
      this.setStatus("reconnecting");
      try { socket.close(); } catch { /* close event or timeout will recover */ }
    });

    socket.addEventListener("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      clearTimeout(this.openTimer);
      clearInterval(this.watchdogTimer);
      this.openTimer = null;
      this.watchdogTimer = null;
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.setStatus("reconnecting");
    const delay = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.handlers.onStatus(this.config.id, status);
  }

  clearTimers() {
    clearTimeout(this.openTimer);
    clearTimeout(this.reconnectTimer);
    clearInterval(this.watchdogTimer);
    this.openTimer = null;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
  }
}

export class PriceFeed {
  constructor({
    WebSocketImpl = globalThis.WebSocket,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
  } = {}) {
    if (!WebSocketImpl) throw new Error("WebSocket is not available in this runtime");
    this.now = now;
    this.listeners = new Set();
    this.started = false;
    this.staleTimer = null;
    this.restTimer = null;
    this.restRequest = null;
    this.fetchImpl = fetchImpl;
    this.quotes = {
      BTC: { coinbase: null, kraken: null, coinbaseRest: null },
      ETH: { coinbase: null, kraken: null, coinbaseRest: null },
    };
    this.sourceStatus = { coinbase: "idle", kraken: "idle", coinbaseRest: "idle" };
    this.connections = SOURCES.map((source) => new ResilientSocket(source, WebSocketImpl, {
      onQuotes: (quotes) => this.handleQuotes(quotes),
      onStatus: (id, status) => this.handleStatus(id, status),
    }));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  start() {
    if (this.started) return;
    this.started = true;
    for (const connection of this.connections) connection.start();
    this.staleTimer = setInterval(() => this.emit(), 1_000);
    this.restTimer = setInterval(() => void this.pollRestFallback(), REST_FALLBACK_INTERVAL_MS);
    void this.pollRestFallback();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    clearInterval(this.staleTimer);
    clearInterval(this.restTimer);
    this.staleTimer = null;
    this.restTimer = null;
    if (this.restRequest) this.restRequest.abort();
    this.restRequest = null;
    for (const connection of this.connections) connection.stop();
  }

  reconnectAll() {
    for (const connection of this.connections) connection.reconnectNow();
    void this.pollRestFallback();
  }

  async pollRestFallback() {
    if (!this.started || !this.fetchImpl || this.restRequest) return;

    const now = this.now();
    const webSocketsAreFresh = ASSETS.every((asset) => ["coinbase", "kraken"].some((source) => {
      const quote = this.quotes[asset][source];
      return quote && now - quote.receivedAt <= STALE_AFTER_MS;
    }));
    const needsFallback = !webSocketsAreFresh;
    if (!needsFallback) {
      this.handleStatus("coinbaseRest", "idle");
      return;
    }

    const controller = new AbortController();
    this.restRequest = controller;
    this.handleStatus("coinbaseRest", "connecting");
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const receivedAt = this.now();
      const results = await Promise.all(ASSETS.map(async (asset) => {
        try {
          const response = await this.fetchImpl(REST_ENDPOINTS[asset], {
            signal: controller.signal,
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error(`REST ${response.status}`);
          return {
            status: "fulfilled",
            value: parseRestTicker(asset, await response.json(), receivedAt),
          };
        } catch (reason) {
          return { status: "rejected", reason };
        }
      }));
      const quotes = results
        .filter((result) => result.status === "fulfilled" && result.value)
        .map((result) => result.value);
      if (quotes.length === 0) throw new Error("all REST fallback requests failed");
      this.handleQuotes(quotes);
      this.handleStatus("coinbaseRest", "open");
    } catch {
      if (this.started) this.handleStatus("coinbaseRest", "reconnecting");
    } finally {
      clearTimeout(timeout);
      if (this.restRequest === controller) this.restRequest = null;
    }
  }

  handleQuotes(quotes) {
    for (const quote of quotes) {
      if (
        !this.quotes[quote.asset]
        || !Object.prototype.hasOwnProperty.call(this.quotes[quote.asset], quote.source)
      ) continue;
      this.quotes[quote.asset][quote.source] = quote;
    }
    this.emit();
  }

  handleStatus(source, status) {
    this.sourceStatus[source] = status;
    this.emit();
  }

  getState() {
    const now = this.now();
    const prices = Object.fromEntries(
      ASSETS.map((asset) => [asset, selectQuote(this.quotes[asset], now)]),
    );
    const current = Object.values(prices).filter(Boolean);
    const fresh = current.filter((quote) => !quote.stale);
    const sourceStates = Object.values(this.sourceStatus);

    let status;
    if (fresh.length === ASSETS.length) status = "live";
    else if (fresh.length > 0) status = "partial";
    else if (current.length > 0) status = "reconnecting";
    else if (sourceStates.some((state) => state === "connecting" || state === "reconnecting" || state === "open")) {
      status = "connecting";
    } else status = "offline";

    return {
      status,
      prices,
      sources: { ...this.sourceStatus },
      lastUpdateAt: current.length > 0
        ? Math.max(...current.map((quote) => quote.receivedAt))
        : null,
    };
  }

  emit() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
