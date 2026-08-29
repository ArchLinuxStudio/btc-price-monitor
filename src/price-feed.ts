import { DEFAULT_PRODUCTS, type Product } from "./watchlist.js";

export type MarketSource = "coinbase" | "kraken" | "bitstamp" | "bitfinex";
export type QuoteSource = MarketSource | "coinbaseRest";
export type QuoteTransport = "ws" | "rest";
export type SourceConnectionStatus = "idle" | "connecting" | "reconnecting" | "open";
export type FeedStatus = "live" | "partial" | "reconnecting" | "connecting" | "offline";

export interface Quote {
  kind?: never;
  asset: string;
  price: number;
  source: QuoteSource;
  marketSource: MarketSource;
  transport?: QuoteTransport;
  sourceLabel: string;
  exchangeAt: number;
  receivedAt: number;
}

export interface DisplayQuote extends Quote {
  stale: boolean;
  changeUtc: number | null;
}

export interface PriceFeedState {
  status: FeedStatus;
  prices: Record<string, DisplayQuote | null>;
  sources: Record<QuoteSource, SourceConnectionStatus>;
  lastUpdateAt: number | null;
}

export interface WebSocketLike {
  readyState: number;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type WebSocketConstructor = new (url: string) => WebSocketLike;

export interface FetchResponseLike {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}

export type FetchImpl = (url: string, init: RequestInit) => Promise<FetchResponseLike>;

export interface PriceFeedOptions {
  WebSocketImpl?: WebSocketConstructor;
  fetchImpl?: FetchImpl | null;
  now?: () => number;
  utcOpenTimeoutMs?: number;
  utcOpenRetryDelayImpl?: (attempt: number) => number;
  products?: readonly Product[];
}

interface UtcOpenEvent {
  kind: "utcOpen";
  asset: string;
  source: "bitfinex";
  marketSource: "bitfinex";
  candleAt: number;
  openPrice: number;
}

interface SubscriptionAckEvent {
  kind: "subscriptionAck";
  key: string;
}

interface SubscriptionErrorEvent {
  kind: "subscriptionError";
  code: number | null;
  message: string;
}

type ParsedSocketEvent = Quote | UtcOpenEvent | SubscriptionAckEvent | SubscriptionErrorEvent;
type QuoteOrUtcOpenEvent = Quote | UtcOpenEvent;
type HandledFeedEvent = IncomingQuote | UtcOpenEvent | SubscriptionAckEvent | SubscriptionErrorEvent;
type SymbolMapping = Map<string, string> | Readonly<Record<string, unknown>> | null;
type SourceQuotes = Partial<Record<QuoteSource, Quote | null>>;
type TimerHandle = ReturnType<typeof setTimeout>;

interface SourceConfig {
  id: MarketSource;
  label: string;
  url: string;
  subscriptions: unknown[];
  parser: (raw: unknown, receivedAt: number) => ParsedSocketEvent[];
  idleTimeoutMs: number;
  quoteTimeoutMs: number;
  assets: string[];
  sentinelAssets: string[];
  pingMessage?: () => unknown;
  subscriptionAckKeys?: string[];
  subscriptionAckTimeoutMs?: number;
}

interface SocketHandlers {
  onQuotes: (quotes: QuoteOrUtcOpenEvent[]) => void;
  onStatus: (id: MarketSource, status: SourceConnectionStatus) => void;
}

interface UtcOpenRecord {
  dayStart: number;
  price: number;
}

interface IncomingQuote {
  kind?: never;
  asset: string;
  price: number;
  source: QuoteSource;
  marketSource?: MarketSource;
  transport?: QuoteTransport;
  sourceLabel: string;
  exchangeAt: number;
  receivedAt: number;
}

interface CoinbaseMessage {
  channel?: unknown;
  timestamp?: unknown;
  events?: Array<{ tickers?: Array<Record<string, unknown>> } | null>;
}

interface KrakenMessage {
  channel?: unknown;
  data?: Array<Record<string, unknown>>;
}

interface BitstampMessage {
  event?: unknown;
  channel?: unknown;
  data?: Record<string, unknown>;
}

const STALE_AFTER_MS = 12_000;
const PRIMARY_PREFERENCE_MS = 5_000;
const REST_FALLBACK_INTERVAL_MS = 5_000;
const DAY_MS = 86_400_000;
const UTC_OPEN_GRANULARITY_SECONDS = 3_600;
const COINBASE_API_ROOT = "https://api.exchange.coinbase.com/products";
const KRAKEN_TICKER_ROOT = "https://api.kraken.com/0/public/Ticker";
const BITSTAMP_API_ROOT = "https://www.bitstamp.net/api/v2";
const SOURCE_IDS: MarketSource[] = ["coinbase", "kraken", "bitstamp", "bitfinex"];
const QUOTE_SOURCE_IDS: QuoteSource[] = (SOURCE_IDS as QuoteSource[]).concat(["coinbaseRest"]);
const REST_CONCURRENCY = 3;
const SOURCE_PRIORITY = new Map(QUOTE_SOURCE_IDS.map((source, index) => [source, index]));

const LEGACY_COINBASE_ASSETS = new Map([
  ["BTC-USD", "BTC"],
  ["ETH-USD", "ETH"],
]);
const LEGACY_KRAKEN_ASSETS = new Map([
  ["BTC/USD", "BTC"],
  ["ETH/USD", "ETH"],
]);

function parseJson<T = unknown>(raw: unknown): T | null {
  try {
    if (typeof raw === "string") return JSON.parse(raw) as T;
    if (raw instanceof ArrayBuffer) {
      return JSON.parse(new TextDecoder().decode(raw)) as T;
    }
    if (ArrayBuffer.isView(raw)) {
      return JSON.parse(new TextDecoder().decode(raw)) as T;
    }
  } catch {
    return null;
  }
  return null;
}

function finiteNumber(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function positivePrice(value: unknown): number | null {
  const result = finiteNumber(value);
  return result !== null && result > 0 ? result : null;
}

function timestamp(value: unknown, fallback: number): number {
  const parsed = value ? Date.parse(value as string) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, limit));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function newestQuoteFirst<T extends { receivedAt: number; source: string }>(left: T, right: T): number {
  const recency = right.receivedAt - left.receivedAt;
  if (recency !== 0) return recency;
  return (SOURCE_PRIORITY.get(left.source as QuoteSource) || 0)
    - (SOURCE_PRIORITY.get(right.source as QuoteSource) || 0);
}

function mappedAsset(
  mapping: SymbolMapping,
  key: unknown,
  legacyMapping: ReadonlyMap<string, string>,
): string | null {
  if (mapping instanceof Map) return mapping.get(key as string) || null;
  if (mapping && typeof mapping === "object") {
    return hasOwn(mapping, key as PropertyKey)
      ? mapping[key as keyof typeof mapping] as string | null
      : null;
  }
  return legacyMapping.get(key as string) || null;
}

function normalizeProduct(raw: Record<string, unknown> | null | undefined): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const rawId = raw.id || raw.coinbaseProductId || raw.productId;
  const id = typeof rawId === "string" ? rawId.trim().toUpperCase() : "";
  if (!id || !id.endsWith("-USD")) return null;

  const rawSymbol = typeof raw.symbol === "string"
    ? raw.symbol.trim().toUpperCase()
    : id.slice(0, -4);
  if (!rawSymbol) return null;

  const rawKrakenSymbol = raw.krakenSymbol || raw.krakenWsSymbol || raw.krakenPair;
  const krakenSymbol = typeof rawKrakenSymbol === "string" && rawKrakenSymbol.trim()
    ? rawKrakenSymbol.trim().toUpperCase()
    : null;
  const bitstampSymbol = typeof raw.bitstampSymbol === "string" && raw.bitstampSymbol.trim()
    ? raw.bitstampSymbol.trim().toLowerCase()
    : null;
  const bitfinexSymbol = typeof raw.bitfinexSymbol === "string" && raw.bitfinexSymbol.trim()
    ? raw.bitfinexSymbol.trim()
    : null;

  return {
    ...raw,
    id,
    symbol: rawSymbol,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : rawSymbol,
    krakenSymbol,
    bitstampSymbol,
    bitfinexSymbol,
    fixed: raw.fixed === true,
  };
}

function normalizeProducts(products: unknown): Product[] {
  const normalized: Product[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(products) ? products : []) {
    const product = normalizeProduct(raw as Record<string, unknown> | null | undefined);
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    normalized.push(product);
  }

  if (normalized.length > 0 || products === DEFAULT_PRODUCTS) return normalized;
  return normalizeProducts(DEFAULT_PRODUCTS);
}

function sourceSupportsProduct(source: MarketSource, product: Product): boolean {
  if (source === "coinbase") return true;
  if (source === "kraken") return Boolean(product.krakenSymbol);
  if (source === "bitstamp") return Boolean(product.bitstampSymbol);
  if (source === "bitfinex") return Boolean(product.bitfinexSymbol);
  return false;
}

function sourceSymbol(source: MarketSource, product: Product): string | null {
  if (source === "coinbase") return product.id;
  if (source === "kraken") return product.krakenSymbol;
  if (source === "bitstamp") return product.bitstampSymbol;
  if (source === "bitfinex") return product.bitfinexSymbol;
  return null;
}

function sourceProductIds(source: MarketSource, products: readonly Product[]): string[] {
  return products
    .filter((product) => sourceSupportsProduct(source, product))
    .map((product) => product.id);
}

export function parseCoinbaseMessage(
  raw: unknown,
  receivedAt = Date.now(),
  productMapping: SymbolMapping = null,
): Quote[] {
  const message = parseJson<CoinbaseMessage>(raw);
  if (!message || message.channel !== "ticker" || !Array.isArray(message.events)) {
    return [];
  }

  const exchangeAt = timestamp(message.timestamp, receivedAt);
  const quotes: Quote[] = [];

  for (const event of message.events) {
    if (!event || !Array.isArray(event.tickers)) continue;

    for (const ticker of event.tickers) {
      const asset = mappedAsset(
        productMapping,
        ticker.product_id,
        LEGACY_COINBASE_ASSETS,
      );
      const price = positivePrice(ticker.price);
      if (!asset || price === null) continue;

      quotes.push({
        asset,
        price,
        source: "coinbase",
        marketSource: "coinbase",
        transport: "ws",
        sourceLabel: "Coinbase",
        exchangeAt,
        receivedAt,
      });
    }
  }

  return quotes;
}

export function parseKrakenMessage(
  raw: unknown,
  receivedAt = Date.now(),
  symbolMapping: SymbolMapping = null,
): Quote[] {
  const message = parseJson<KrakenMessage>(raw);
  if (!message || message.channel !== "ticker" || !Array.isArray(message.data)) {
    return [];
  }

  const quotes: Quote[] = [];
  for (const ticker of message.data) {
    const asset = mappedAsset(symbolMapping, ticker.symbol, LEGACY_KRAKEN_ASSETS);
    const price = positivePrice(ticker.last);
    if (!asset || price === null) continue;

    quotes.push({
      asset,
      price,
      source: "kraken",
      marketSource: "kraken",
      transport: "ws",
      sourceLabel: "Kraken",
      exchangeAt: timestamp(ticker.timestamp, receivedAt),
      receivedAt,
    });
  }

  return quotes;
}

function bitstampExchangeAt(data: Record<string, unknown>, receivedAt: number): number {
  const microseconds = finiteNumber(data && data.microtimestamp);
  if (microseconds !== null && microseconds > 0) return Math.floor(microseconds / 1_000);
  const seconds = finiteNumber(data && data.timestamp);
  return seconds !== null && seconds > 0 ? Math.floor(seconds * 1_000) : receivedAt;
}

export function parseBitstampMessage(
  raw: unknown,
  receivedAt = Date.now(),
  symbolMapping: SymbolMapping = null,
): Quote[] {
  const message = parseJson<BitstampMessage>(raw);
  if (
    !message
    || message.event !== "trade"
    || typeof message.channel !== "string"
    || !message.channel.startsWith("live_trades_")
    || !message.data
    || typeof message.data !== "object"
  ) return [];

  const marketSymbol = message.channel.slice("live_trades_".length);
  const asset = mappedAsset(symbolMapping, marketSymbol, new Map());
  const price = positivePrice(message.data.price_str || message.data.price);
  if (!asset || price === null) return [];
  return [{
    asset,
    price,
    source: "bitstamp",
    marketSource: "bitstamp",
    transport: "ws",
    sourceLabel: "Bitstamp",
    exchangeAt: bitstampExchangeAt(message.data, receivedAt),
    receivedAt,
  }];
}

function bitfinexTradeQuote(
  asset: string,
  trade: unknown,
  receivedAt: number,
  snapshot: boolean,
): Quote | null {
  if (!Array.isArray(trade)) return null;
  const exchangeAt = finiteNumber(trade[1]);
  const price = positivePrice(trade[3]);
  if (exchangeAt === null || exchangeAt <= 0 || price === null) return null;
  return {
    asset,
    price,
    source: "bitfinex",
    marketSource: "bitfinex",
    transport: "ws",
    sourceLabel: "Bitfinex",
    exchangeAt,
    receivedAt: snapshot ? Math.min(receivedAt, exchangeAt) : receivedAt,
  };
}

function bitfinexUtcOpenEvent(asset: string, candle: unknown): UtcOpenEvent | null {
  if (!Array.isArray(candle)) return null;
  const candleAt = finiteNumber(candle[0]);
  const openPrice = positivePrice(candle[1]);
  const volume = positivePrice(candle[5]);
  if (candleAt === null || candleAt <= 0 || openPrice === null || volume === null) return null;
  return {
    kind: "utcOpen",
    asset,
    source: "bitfinex",
    marketSource: "bitfinex",
    candleAt,
    openPrice,
  };
}

export function createBitfinexTradesParser(symbolMapping: SymbolMapping = null) {
  const channels = new Map<number, { asset: string; channel: "trades" | "candles" }>();
  const candleMapping = new Map<string, string>();
  if (symbolMapping instanceof Map) {
    for (const [symbol, asset] of symbolMapping.entries()) {
      candleMapping.set(`trade:1D:${symbol}`, asset);
    }
  }
  return (raw: unknown, receivedAt = Date.now()): ParsedSocketEvent[] => {
    const message = parseJson(raw) as unknown[] | Record<string, unknown> | null;
    if (!message) return [];

    if (!Array.isArray(message)) {
      if (message.event === "subscribed" && finiteNumber(message.chanId) !== null) {
        if (message.channel === "trades") {
          const asset = mappedAsset(symbolMapping, message.symbol, new Map());
          if (asset) {
            channels.set(Number(message.chanId), { asset, channel: "trades" });
            return [{ kind: "subscriptionAck", key: `trades:${message.symbol}` }];
          }
        } else if (message.channel === "candles") {
          const asset = candleMapping.get(message.key as string);
          if (asset) {
            channels.set(Number(message.chanId), { asset, channel: "candles" });
            return [{ kind: "subscriptionAck", key: `candles:${message.key}` }];
          }
        }
      }
      if (message.event === "error") {
        return [{
          kind: "subscriptionError",
          code: finiteNumber(message.code),
          message: typeof message.msg === "string" ? message.msg : "Bitfinex subscription error",
        }];
      }
      return [];
    }

    const channel = channels.get(Number(message[0]));
    if (!channel || message[1] === "hb") return [];
    if (channel.channel === "candles") {
      const candles = Array.isArray(message[1]) && Array.isArray(message[1][0])
        ? message[1]
        : [message[1]];
      let newest = null;
      for (const candle of candles) {
        const event = bitfinexUtcOpenEvent(channel.asset, candle);
        if (event && (!newest || event.candleAt > newest.candleAt)) newest = event;
      }
      return newest ? [newest] : [];
    }
    if (Array.isArray(message[1])) {
      let newest = null;
      for (const trade of message[1]) {
        const quote = bitfinexTradeQuote(channel.asset, trade, receivedAt, true);
        if (quote && (!newest || quote.exchangeAt > newest.exchangeAt)) newest = quote;
      }
      return newest ? [newest] : [];
    }
    if ((message[1] === "te" || message[1] === "tu") && Array.isArray(message[2])) {
      const quote = bitfinexTradeQuote(channel.asset, message[2], receivedAt, false);
      return quote ? [quote] : [];
    }
    return [];
  };
}

export function parseRestTicker(
  asset: unknown,
  payload: unknown,
  receivedAt?: number,
): Quote | null;
export function parseRestTicker(
  asset: unknown,
  payload: unknown,
  receivedAt = Date.now(),
): Quote | null {
  if (typeof asset !== "string" || !asset || !payload || typeof payload !== "object") {
    return null;
  }
  const price = positivePrice((payload as Record<string, unknown>).price);
  if (price === null) return null;
  const tickerAt = timestamp((payload as Record<string, unknown>).time, receivedAt);
  return {
    asset,
    price,
    source: "coinbaseRest",
    marketSource: "coinbase",
    transport: "rest",
    sourceLabel: "Coinbase REST",
    exchangeAt: tickerAt,
    // Coinbase's ticker time is the last trade time. Using it for freshness
    // prevents a quiet market's old last trade from looking newly received.
    receivedAt: tickerAt,
  };
}

export function utcDayStart(timestampMs: number): number;
export function utcDayStart(timestampMs: unknown): number | null;
export function utcDayStart(timestampMs: unknown): number | null {
  const value = finiteNumber(timestampMs);
  return value === null ? null : Math.floor(value / DAY_MS) * DAY_MS;
}

export function calculateUtcChange(price: unknown, openPrice: unknown): number | null {
  const current = positivePrice(price);
  const open = positivePrice(openPrice);
  return current === null || open === null ? null : ((current / open) - 1) * 100;
}

function utcOpenSource(
  quoteOrSource: Quote | IncomingQuote | UtcOpenEvent | QuoteSource | MarketSource,
): MarketSource;
function utcOpenSource(quoteOrSource: unknown): MarketSource | null;
function utcOpenSource(quoteOrSource: unknown): MarketSource | null {
  if (
    quoteOrSource
    && typeof quoteOrSource === "object"
    && (quoteOrSource as Record<string, unknown>).marketSource
  ) {
    return (quoteOrSource as Record<string, unknown>).marketSource as MarketSource;
  }
  const source = quoteOrSource && typeof quoteOrSource === "object"
    ? (quoteOrSource as Record<string, unknown>).source
    : quoteOrSource;
  return (source === "coinbaseRest" ? "coinbase" : source) as MarketSource | null;
}

function utcOpenRetryDelay(attempt: number): number {
  return Math.min(2_000 * (2 ** Math.min(Math.max(0, attempt), 5)), 60_000);
}

export function parseCoinbaseUtcOpen(
  payload: unknown,
  dayStartMs: number,
  windowMs = DAY_MS,
): number | null {
  if (!Array.isArray(payload)) return null;
  const startSeconds = Math.floor(dayStartMs / 1_000);
  const endSeconds = Math.floor((dayStartMs + windowMs) / 1_000);
  const matching = payload
    .filter((candle) => (
      Array.isArray(candle)
      && finiteNumber(candle[0]) !== null
      && Number(candle[0]) >= startSeconds
      && Number(candle[0]) < endSeconds
      && positivePrice(candle[3]) !== null
    ))
    .sort((left, right) => Number(left[0]) - Number(right[0]));
  return matching.length > 0 ? positivePrice(matching[0][3]) : null;
}

export function parseBitstampUtcOpen(
  payload: unknown,
  dayStartMs: number,
  windowMs = DAY_MS,
): number | null {
  const value = payload as { data?: { ohlc?: unknown } } | null;
  const candles = value && value.data && value.data.ohlc;
  if (!Array.isArray(candles)) return null;
  const startSeconds = Math.floor(dayStartMs / 1_000);
  const endSeconds = Math.floor((dayStartMs + windowMs) / 1_000);
  const matching = candles
    .filter((candle) => (
      candle
      && typeof candle === "object"
      && finiteNumber(candle.timestamp) !== null
      && Number(candle.timestamp) >= startSeconds
      && Number(candle.timestamp) < endSeconds
      && positivePrice(candle.open) !== null
      && positivePrice(candle.volume) !== null
    ))
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
  return matching.length > 0 ? positivePrice(matching[0].open) : null;
}

function legacyKrakenUtcOpens(payload: unknown): Record<string, number | null> {
  const parsed: Record<string, number | null> = { BTC: null, ETH: null };
  const value = payload as Record<string, unknown> | null;
  if (
    !value
    || typeof value !== "object"
    || !Array.isArray(value.error)
    || value.error.length > 0
    || !value.result
    || typeof value.result !== "object"
  ) return parsed;

  for (const [key, entry] of Object.entries(value.result)) {
    if (!entry || typeof entry !== "object") continue;
    const result = entry as Record<string, unknown>;
    const normalized = key.toUpperCase().replace(/[^A-Z]/g, "");
    if (normalized.includes("ETH") && normalized.endsWith("USD")) {
      parsed.ETH = positivePrice(result.o);
    } else if (
      (normalized.includes("BTC") || normalized.includes("XBT"))
      && normalized.endsWith("USD")
    ) {
      parsed.BTC = positivePrice(result.o);
    }
  }
  return parsed;
}

export function parseKrakenUtcOpens(
  payload: unknown,
  products: ReadonlyMap<string, string> | readonly Product[] | null = null,
): Record<string, number | null> {
  if (!products) return legacyKrakenUtcOpens(payload);

  const targets = products instanceof Map
    ? products
    : new Map(
      (Array.isArray(products) ? products : [])
        .filter((product) => product && product.krakenSymbol)
        .map((product) => [product.krakenSymbol, product.id]),
    );
  const parsed: Record<string, number | null> = {};
  for (const asset of targets.values()) parsed[asset] = null;

  const value = payload as Record<string, unknown> | null;
  if (
    !value
    || typeof value !== "object"
    || !Array.isArray(value.error)
    || value.error.length > 0
    || !value.result
    || typeof value.result !== "object"
  ) return parsed;

  const normalizedTargets = new Map();
  for (const [symbol, asset] of targets.entries()) {
    normalizedTargets.set(String(symbol).toUpperCase(), asset);
  }
  for (const [key, entry] of Object.entries(value.result)) {
    if (!entry || typeof entry !== "object") continue;
    const asset = normalizedTargets.get(key.toUpperCase());
    if (!asset) continue;
    parsed[asset] = positivePrice((entry as Record<string, unknown>).o);
  }
  return parsed;
}

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.min(Math.max(0, attempt), 6);
  const base = Math.min(500 * (2 ** exponent), 30_000);
  const jitter = 0.75 + random() * 0.5;
  return Math.round(base * jitter);
}

interface SelectableQuote {
  source: string;
  receivedAt: number;
}

export function selectQuote<T extends SelectableQuote>(
  sourceQuotes: Partial<Record<QuoteSource, T | null | undefined>> | null | undefined,
  now = Date.now(),
): (T & { stale: boolean }) | null {
  const quotes = Object.values(sourceQuotes || {}).filter((quote): quote is T => Boolean(quote));
  if (quotes.length === 0) return null;

  const coinbase = sourceQuotes?.coinbase;
  if (coinbase && now - coinbase.receivedAt <= PRIMARY_PREFERENCE_MS) {
    return { ...coinbase, stale: false };
  }

  const freshWebSockets = quotes
    .filter((quote) => quote.source !== "coinbaseRest")
    .filter((quote) => now - quote.receivedAt <= STALE_AFTER_MS)
    .sort(newestQuoteFirst);
  if (freshWebSockets.length > 0) return { ...freshWebSockets[0], stale: false };

  const restFallback = sourceQuotes?.coinbaseRest;
  if (restFallback && now - restFallback.receivedAt <= STALE_AFTER_MS) {
    return { ...restFallback, stale: false };
  }

  const newest = quotes.sort(newestQuoteFirst)[0];
  return { ...newest, stale: true };
}

class ResilientSocket {
  declare config: SourceConfig;
  declare WebSocketImpl: WebSocketConstructor;
  declare handlers: SocketHandlers;
  declare now: () => number;
  declare socket: WebSocketLike | null;
  declare status: SourceConnectionStatus;
  declare stopped: boolean;
  declare reconnectAttempt: number;
  declare lastMessageAt: number;
  declare openedAt: number;
  declare lastQuoteAt: Record<string, number>;
  declare openTimer: TimerHandle | null;
  declare watchdogTimer: TimerHandle | null;
  declare reconnectTimer: TimerHandle | null;
  declare subscriptionAckTimer: TimerHandle | null;
  declare pendingSubscriptionAcks: Set<string>;

  constructor(
    config: SourceConfig,
    WebSocketImpl: WebSocketConstructor,
    handlers: SocketHandlers,
    now: () => number = () => Date.now(),
  ) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.handlers = handlers;
    this.now = now;
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
    this.subscriptionAckTimer = null;
    this.pendingSubscriptionAcks = new Set();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
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

  reconnectNow(): void {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer as TimerHandle);
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

  hasExpiredSentinelQuotes(now = this.now()): boolean {
    return this.config.sentinelAssets.some((asset) => {
      const lastQuoteAt = this.lastQuoteAt[asset] || this.openedAt;
      return now - lastQuoteAt > this.config.quoteTimeoutMs;
    });
  }

  connect(): void {
    if (this.stopped || this.socket) return;
    clearTimeout(this.reconnectTimer as TimerHandle);
    this.reconnectTimer = null;
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    let socket: WebSocketLike;
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
      clearTimeout(this.openTimer as TimerHandle);
      this.openTimer = null;
      this.lastMessageAt = this.now();
      this.openedAt = this.lastMessageAt;
      for (const asset of this.config.assets) this.lastQuoteAt[asset] = 0;
      this.setStatus("open");

      for (const subscription of this.config.subscriptions) {
        socket.send(JSON.stringify(subscription));
      }

      this.pendingSubscriptionAcks = new Set(this.config.subscriptionAckKeys || []);
      if (this.pendingSubscriptionAcks.size > 0) {
        this.subscriptionAckTimer = setTimeout(() => {
          if (socket === this.socket && socket.readyState === 1) {
            try { socket.close(4003, "subscription acknowledgement timeout"); } catch { /* no-op */ }
          }
        }, this.config.subscriptionAckTimeoutMs || 10_000);
      }

      this.watchdogTimer = setInterval(() => {
        if (socket !== this.socket || socket.readyState !== 1) return;
        const idleFor = this.now() - this.lastMessageAt;
        if (idleFor > this.config.idleTimeoutMs) {
          try { socket.close(4000, "feed timeout"); } catch { /* no-op */ }
          return;
        }
        // Custom products can legitimately go many seconds without a trade.
        // Only the always-present BTC/ETH sentinels may declare a shared ticker
        // subscription unhealthy; individual custom products become stale and
        // use the REST fallback without disrupting every other product.
        if (this.hasExpiredSentinelQuotes()) {
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
      this.lastMessageAt = this.now();
      const events = this.config.parser(event.data, this.lastMessageAt);
      const quotes: QuoteOrUtcOpenEvent[] = [];
      let subscriptionFailed = false;
      for (const item of events) {
        if (item.kind === "subscriptionAck") {
          this.pendingSubscriptionAcks.delete(item.key);
          if (this.pendingSubscriptionAcks.size === 0) {
            clearTimeout(this.subscriptionAckTimer as TimerHandle);
            this.subscriptionAckTimer = null;
          }
        } else if (item.kind === "subscriptionError") {
          subscriptionFailed = true;
        } else {
          quotes.push(item);
        }
      }
      if (subscriptionFailed) {
        try { socket.close(4003, "subscription rejected"); } catch { /* no-op */ }
        return;
      }
      if (quotes.length > 0) {
        this.reconnectAttempt = 0;
        for (const item of quotes) {
          if (item.kind !== "utcOpen") this.lastQuoteAt[item.asset] = this.lastMessageAt;
        }
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
      clearTimeout(this.openTimer as TimerHandle);
      clearInterval(this.watchdogTimer as TimerHandle);
      clearTimeout(this.subscriptionAckTimer as TimerHandle);
      this.openTimer = null;
      this.watchdogTimer = null;
      this.subscriptionAckTimer = null;
      this.pendingSubscriptionAcks.clear();
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.setStatus("reconnecting");
    const delay = reconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  setStatus(status: SourceConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.handlers.onStatus(this.config.id, status);
  }

  clearTimers(): void {
    clearTimeout(this.openTimer as TimerHandle);
    clearTimeout(this.reconnectTimer as TimerHandle);
    clearInterval(this.watchdogTimer as TimerHandle);
    clearTimeout(this.subscriptionAckTimer as TimerHandle);
    this.openTimer = null;
    this.reconnectTimer = null;
    this.watchdogTimer = null;
    this.subscriptionAckTimer = null;
    this.pendingSubscriptionAcks.clear();
  }
}

function buildSourceConfigs(products: readonly Product[]): SourceConfig[] {
  const coinbaseMapping = new Map(products.map((product) => [product.id, product.id]));
  const krakenProducts = products.filter((product) => product.krakenSymbol) as Array<
    Product & { krakenSymbol: string }
  >;
  const krakenMapping = new Map(
    krakenProducts.map((product) => [product.krakenSymbol, product.id]),
  );
  const sentinelIds = products
    .filter((product) => product.symbol === "BTC" || product.symbol === "ETH")
    .map((product) => product.id);
  const bitstampProducts = products.filter((product) => product.bitstampSymbol) as Array<
    Product & { bitstampSymbol: string }
  >;
  const bitstampMapping = new Map(
    bitstampProducts.map((product) => [product.bitstampSymbol, product.id]),
  );
  const bitfinexProducts = products.filter((product) => product.bitfinexSymbol) as Array<
    Product & { bitfinexSymbol: string }
  >;
  const bitfinexMapping = new Map(
    bitfinexProducts.map((product) => [product.bitfinexSymbol, product.id]),
  );
  const bitfinexSubscriptions: Array<{
    event: "subscribe";
    channel: "trades";
    symbol: string;
  } | {
    event: "subscribe";
    channel: "candles";
    key: string;
  }> = [];
  for (const product of bitfinexProducts) {
    bitfinexSubscriptions.push(
      {
        event: "subscribe",
        channel: "trades",
        symbol: product.bitfinexSymbol,
      },
      {
        event: "subscribe",
        channel: "candles",
        key: `trade:1D:${product.bitfinexSymbol}`,
      },
    );
  }

  const configs: SourceConfig[] = [{
    id: "coinbase",
    label: "Coinbase",
    url: "wss://advanced-trade-ws.coinbase.com",
    subscriptions: [
      {
        type: "subscribe",
        product_ids: products.map((product) => product.id),
        channel: "ticker",
      },
      { type: "subscribe", channel: "heartbeats" },
    ],
    parser: (raw, receivedAt) => parseCoinbaseMessage(raw, receivedAt, coinbaseMapping),
    idleTimeoutMs: 10_000,
    quoteTimeoutMs: 20_000,
    assets: products.map((product) => product.id),
    sentinelAssets: sentinelIds,
  }];

  if (krakenProducts.length > 0) {
    configs.push({
      id: "kraken",
      label: "Kraken",
      url: "wss://ws.kraken.com/v2",
      subscriptions: [{
        method: "subscribe",
        params: {
          channel: "ticker",
          symbol: krakenProducts.map((product) => product.krakenSymbol),
          event_trigger: "trades",
          snapshot: true,
        },
        req_id: 1,
      }],
      parser: (raw, receivedAt) => parseKrakenMessage(raw, receivedAt, krakenMapping),
      idleTimeoutMs: 10_000,
      quoteTimeoutMs: 20_000,
      assets: krakenProducts.map((product) => product.id),
      sentinelAssets: sentinelIds.filter((id) => krakenProducts.some((product) => product.id === id)),
      pingMessage: () => ({ method: "ping", req_id: Date.now() % 2_147_483_647 }),
    });
  }

  if (bitstampProducts.length > 0) {
    configs.push({
      id: "bitstamp",
      label: "Bitstamp",
      url: "wss://ws.bitstamp.net",
      subscriptions: bitstampProducts.map((product) => ({
        event: "bts:subscribe",
        data: { channel: `live_trades_${product.bitstampSymbol}` },
      })),
      parser: (raw, receivedAt) => parseBitstampMessage(raw, receivedAt, bitstampMapping),
      idleTimeoutMs: 30_000,
      quoteTimeoutMs: 30_000,
      assets: bitstampProducts.map((product) => product.id),
      sentinelAssets: sentinelIds.filter((id) => (
        bitstampProducts.some((product) => product.id === id)
      )),
    });
  }

  if (bitfinexProducts.length > 0) {
    configs.push({
      id: "bitfinex",
      label: "Bitfinex",
      url: "wss://api-pub.bitfinex.com/ws/2",
      subscriptions: bitfinexSubscriptions,
      parser: createBitfinexTradesParser(bitfinexMapping),
      subscriptionAckKeys: bitfinexSubscriptions.map((subscription) => (
        subscription.channel === "trades"
          ? `trades:${subscription.symbol}`
          : `candles:${subscription.key}`
      )),
      subscriptionAckTimeoutMs: 10_000,
      idleTimeoutMs: 30_000,
      quoteTimeoutMs: 30_000,
      assets: bitfinexProducts.map((product) => product.id),
      sentinelAssets: sentinelIds.filter((id) => (
        bitfinexProducts.some((product) => product.id === id)
      )),
    });
  }

  return configs;
}

export class PriceFeed {
  declare WebSocketImpl: WebSocketConstructor;
  declare now: () => number;
  declare utcOpenTimeoutMs: number;
  declare utcOpenRetryDelay: (attempt: number) => number;
  declare listeners: Set<(state: PriceFeedState) => void>;
  declare started: boolean;
  declare revision: number;
  declare staleTimer: TimerHandle | null;
  declare restTimer: TimerHandle | null;
  declare restRequest: AbortController | null;
  declare fetchImpl: FetchImpl | null;
  declare sourceStatus: Record<QuoteSource, SourceConnectionStatus>;
  declare utcOpenDay: Record<MarketSource, number | null>;
  declare utcOpenRequests: Record<MarketSource, Promise<void> | null>;
  declare utcOpenControllers: Record<MarketSource, AbortController | null>;
  declare utcOpenPending: Record<MarketSource, Set<string>>;
  declare utcOpenRetryTimers: Record<MarketSource, TimerHandle | null>;
  declare utcOpenRetryTimerAt: Record<MarketSource, number>;
  declare products: Product[];
  declare productById: Map<string, Product>;
  declare productIdBySymbol: Map<string, string>;
  declare quotes: Record<string, SourceQuotes>;
  declare utcOpens: Record<MarketSource, Record<string, UtcOpenRecord | null>>;
  declare utcOpenRetryAt: Record<MarketSource, Record<string, number>>;
  declare utcOpenRetryAttempt: Record<MarketSource, Record<string, number>>;
  declare connections: ResilientSocket[];

  constructor({
    WebSocketImpl = globalThis.WebSocket as unknown as WebSocketConstructor,
    fetchImpl = typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis) as FetchImpl
      : null,
    now = () => Date.now(),
    utcOpenTimeoutMs = 8_000,
    utcOpenRetryDelayImpl = utcOpenRetryDelay,
    products = DEFAULT_PRODUCTS,
  }: PriceFeedOptions = {}) {
    if (!WebSocketImpl) throw new Error("WebSocket is not available in this runtime");
    this.WebSocketImpl = WebSocketImpl;
    this.now = now;
    this.utcOpenTimeoutMs = utcOpenTimeoutMs;
    this.utcOpenRetryDelay = typeof utcOpenRetryDelayImpl === "function"
      ? utcOpenRetryDelayImpl
      : utcOpenRetryDelay;
    this.listeners = new Set();
    this.started = false;
    this.revision = 0;
    this.staleTimer = null;
    this.restTimer = null;
    this.restRequest = null;
    this.fetchImpl = fetchImpl;
    this.sourceStatus = Object.fromEntries(
      QUOTE_SOURCE_IDS.map((source) => [source, "idle"]),
    ) as Record<QuoteSource, SourceConnectionStatus>;
    this.utcOpenDay = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, null]),
    ) as Record<MarketSource, number | null>;
    this.utcOpenRequests = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, null]),
    ) as Record<MarketSource, Promise<void> | null>;
    this.utcOpenControllers = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, null]),
    ) as Record<MarketSource, AbortController | null>;
    this.utcOpenPending = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, new Set()]),
    ) as Record<MarketSource, Set<string>>;
    this.utcOpenRetryTimers = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, null]),
    ) as Record<MarketSource, TimerHandle | null>;
    this.utcOpenRetryTimerAt = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, 0]),
    ) as Record<MarketSource, number>;
    this.products = [];
    this.productById = new Map();
    this.productIdBySymbol = new Map();
    this.quotes = {};
    this.utcOpens = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, UtcOpenRecord | null>>;
    this.utcOpenRetryAt = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, number>>;
    this.utcOpenRetryAttempt = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, number>>;
    this.applyProducts(normalizeProducts(products), false);
    this.connections = this.createConnections();
  }

  createConnections(): ResilientSocket[] {
    return buildSourceConfigs(this.products).map((source) => new ResilientSocket(
      source,
      this.WebSocketImpl,
      {
        onQuotes: (quotes) => this.handleQuotes(quotes),
        onStatus: (id, status) => this.handleStatus(id, status),
      },
      this.now,
    ));
  }

  applyProducts(products: Product[], preserve: boolean): void {
    const previousProducts = this.productById;
    const previousQuotes = this.quotes;
    const previousOpens = this.utcOpens;
    const previousRetryAt = this.utcOpenRetryAt;
    const previousRetryAttempt = this.utcOpenRetryAttempt;

    this.products = products;
    this.productById = new Map(products.map((product) => [product.id, product]));
    this.productIdBySymbol = new Map();
    for (const product of products) {
      if (!this.productIdBySymbol.has(product.symbol)) {
        this.productIdBySymbol.set(product.symbol, product.id);
      }
    }

    this.quotes = {};
    this.utcOpens = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, UtcOpenRecord | null>>;
    this.utcOpenRetryAt = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, number>>;
    this.utcOpenRetryAttempt = Object.fromEntries(
      SOURCE_IDS.map((source) => [source, {}]),
    ) as Record<MarketSource, Record<string, number>>;

    for (const product of products) {
      const oldProduct = previousProducts && previousProducts.get(product.id);
      const oldQuotes = preserve && previousQuotes ? previousQuotes[product.id] : null;
      const sameSourcePair = Object.fromEntries(SOURCE_IDS.map((source) => [
        source,
        Boolean(
          oldProduct
          && sourceSymbol(source, oldProduct)
          && sourceSymbol(source, oldProduct) === sourceSymbol(source, product),
        ),
      ]));
      this.quotes[product.id] = Object.fromEntries(QUOTE_SOURCE_IDS.map((source) => {
        const marketSource = source === "coinbaseRest" ? "coinbase" : source;
        const mayPreserve = marketSource === "coinbase" || sameSourcePair[marketSource];
        return [source, oldQuotes && mayPreserve ? oldQuotes[source] || null : null];
      }));

      for (const source of SOURCE_IDS) {
        const mayPreserve = source === "coinbase" || sameSourcePair[source];
        this.utcOpens[source][product.id] = preserve && mayPreserve && previousOpens[source]
          ? previousOpens[source][product.id] || null
          : null;
        this.utcOpenRetryAt[source][product.id] = preserve && mayPreserve && previousRetryAt[source]
          ? previousRetryAt[source][product.id] || 0
          : 0;
        this.utcOpenRetryAttempt[source][product.id] = preserve
          && mayPreserve
          && previousRetryAttempt[source]
          ? previousRetryAttempt[source][product.id] || 0
          : 0;
      }
    }
  }

  subscribe(listener: (state: PriceFeedState) => void): () => boolean {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const connection of this.connections) connection.start();
    this.staleTimer = setInterval(() => this.emit(), 1_000);
    this.restTimer = setInterval(() => void this.pollRestFallback(), REST_FALLBACK_INTERVAL_MS);
    void this.pollRestFallback();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.revision += 1;
    clearInterval(this.staleTimer as TimerHandle);
    clearInterval(this.restTimer as TimerHandle);
    this.staleTimer = null;
    this.restTimer = null;
    this.abortRequests();
    for (const connection of this.connections) connection.stop();
  }

  abortRequests(): void {
    if (this.restRequest) this.restRequest.abort();
    this.restRequest = null;
    for (const source of SOURCE_IDS) {
      if (this.utcOpenControllers[source]) this.utcOpenControllers[source].abort();
      clearTimeout(this.utcOpenRetryTimers[source] as TimerHandle);
      this.utcOpenControllers[source] = null;
      this.utcOpenRequests[source] = null;
      this.utcOpenRetryTimers[source] = null;
      this.utcOpenRetryTimerAt[source] = 0;
      this.utcOpenPending[source].clear();
    }
  }

  setProducts(products: readonly Product[]): void {
    const nextProducts = normalizeProducts(products);
    const currentSignature = this.products
      .map((product) => SOURCE_IDS
        .map((source) => sourceSymbol(source, product) || "")
        .join("\u0000"))
      .join("\u0001");
    const nextSignature = nextProducts
      .map((product) => SOURCE_IDS
        .map((source) => sourceSymbol(source, product) || "")
        .join("\u0000"))
      .join("\u0001");

    if (currentSignature === nextSignature) {
      this.applyProducts(nextProducts, true);
      this.emit();
      return;
    }

    const wasStarted = this.started;
    this.revision += 1;
    this.abortRequests();
    for (const connection of this.connections) connection.stop();
    this.sourceStatus.coinbaseRest = "idle";
    this.applyProducts(nextProducts, true);
    this.connections = this.createConnections();

    if (wasStarted) {
      for (const connection of this.connections) connection.start();
      void this.pollRestFallback();
    }
    this.emit();
  }

  reconnectAll(): void {
    for (const connection of this.connections) connection.reconnectNow();
    void this.pollRestFallback();
  }

  async pollRestFallback(): Promise<void> {
    if (!this.started || !this.fetchImpl || this.restRequest) return;

    const now = this.now();
    const neededProducts = this.products.filter((product) => {
      const sourceQuotes = this.quotes[product.id];
      return !SOURCE_IDS.map((source) => sourceQuotes[source]).some((quote) => (
        quote && now - quote.receivedAt <= STALE_AFTER_MS
      ));
    });
    if (neededProducts.length === 0) {
      this.handleStatus("coinbaseRest", "idle");
      return;
    }

    const controller = new AbortController();
    const revision = this.revision;
    this.restRequest = controller;
    this.handleStatus("coinbaseRest", "connecting");
    const timeout = setTimeout(() => controller.abort(), 8_000);

    try {
      const fetchedAt = this.now();
      const results = await mapWithConcurrency(neededProducts, REST_CONCURRENCY, async (product) => {
        try {
          const productId = encodeURIComponent(product.id);
          const response = await this.fetchImpl!(`${COINBASE_API_ROOT}/${productId}/ticker`, {
            signal: controller.signal,
            cache: "no-store",
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error(`REST ${response.status}`);
          return parseRestTicker(product.id, await response.json(), fetchedAt);
        } catch {
          return null;
        }
      });
      if (!this.started || revision !== this.revision) return;
      const quotes = results.filter(Boolean) as Quote[];
      if (quotes.length === 0) throw new Error("all REST fallback requests failed");
      this.handleQuotes(quotes);
      this.handleStatus("coinbaseRest", "open");
    } catch {
      if (this.started && revision === this.revision) {
        this.handleStatus("coinbaseRest", "reconnecting");
      }
    } finally {
      clearTimeout(timeout);
      if (this.restRequest === controller) this.restRequest = null;
    }
  }

  resetUtcOpenDay(source: MarketSource, dayStart: number, exchangeAt: number): void {
    if (this.utcOpenControllers[source]) this.utcOpenControllers[source].abort();
    clearTimeout(this.utcOpenRetryTimers[source] as TimerHandle);
    this.utcOpenControllers[source] = null;
    this.utcOpenRequests[source] = null;
    this.utcOpenRetryTimers[source] = null;
    this.utcOpenRetryTimerAt[source] = 0;
    this.utcOpenPending[source].clear();
    this.utcOpenDay[source] = dayStart;
    const millisecondsIntoDay = Math.max(0, exchangeAt - dayStart);
    const firstRetryAt = this.now() + Math.max(0, 2_000 - millisecondsIntoDay);
    for (const product of this.products) {
      this.utcOpens[source][product.id] = null;
      this.utcOpenRetryAttempt[source][product.id] = 0;
      this.utcOpenRetryAt[source][product.id] = firstRetryAt;
    }
  }

  ensureUtcOpen(quote: Quote): void {
    this.ensureUtcOpens([quote]);
  }

  ensureSelectedUtcOpens(): void {
    const now = this.now();
    const selected = [];
    for (const product of this.products) {
      const quote = selectQuote(this.quotes[product.id], now);
      if (quote) selected.push(quote);
    }
    this.ensureUtcOpens(selected);
  }

  ensureUtcOpens(quotes: readonly Quote[]): void {
    if (!this.started || !this.fetchImpl) return;
    const currentDayStart = utcDayStart(this.now());
    const touchedSources = new Set<MarketSource>();

    for (const quote of quotes) {
      const productId = this.resolveProductId(quote.asset);
      const product = productId ? this.productById.get(productId) : null;
      const source = utcOpenSource(quote);
      if (
        !product
        || !SOURCE_IDS.includes(source)
        || !sourceSupportsProduct(source, product)
      ) continue;

      const dayStart = utcDayStart(quote.exchangeAt);
      if (dayStart === null || dayStart !== currentDayStart) continue;
      // Bitfinex sends the UTC daily candle on the same public socket as
      // trades. Its REST API does not expose browser CORS, so the WebView must
      // not attempt a REST candle request for this source.
      if (source === "bitfinex") continue;
      const trackedDay = this.utcOpenDay[source];
      if (trackedDay === null || dayStart > trackedDay) {
        this.resetUtcOpenDay(source, dayStart, quote.exchangeAt);
      } else if (dayStart < trackedDay) {
        continue;
      }

      const record = this.utcOpens[source][productId as string];
      if (!record || record.dayStart !== dayStart) {
        this.utcOpenPending[source].add(productId as string);
        touchedSources.add(source);
      }
    }

    for (const source of touchedSources) {
      this.drainUtcOpen(source, this.utcOpenDay[source] as number);
    }
  }

  scheduleUtcOpenRetry(
    source: MarketSource,
    dayStart: number,
    revision = this.revision,
  ): void {
    if (
      !this.started
      || revision !== this.revision
      || this.utcOpenDay[source] !== dayStart
    ) return;

    let nextRetryAt = Number.POSITIVE_INFINITY;
    for (const productId of Array.from(this.utcOpenPending[source])) {
      const product = this.productById.get(productId);
      const record = this.utcOpens[source][productId];
      if (
        !product
        || !sourceSupportsProduct(source, product)
        || (record && record.dayStart === dayStart)
      ) {
        this.utcOpenPending[source].delete(productId);
        continue;
      }
      nextRetryAt = Math.min(
        nextRetryAt,
        this.utcOpenRetryAt[source][productId] || 0,
      );
    }

    clearTimeout(this.utcOpenRetryTimers[source] as TimerHandle);
    this.utcOpenRetryTimers[source] = null;
    this.utcOpenRetryTimerAt[source] = 0;
    if (!Number.isFinite(nextRetryAt)) return;

    const delay = Math.max(0, nextRetryAt - this.now());
    this.utcOpenRetryTimerAt[source] = nextRetryAt;
    this.utcOpenRetryTimers[source] = setTimeout(() => {
      this.utcOpenRetryTimers[source] = null;
      this.utcOpenRetryTimerAt[source] = 0;
      if (
        !this.started
        || revision !== this.revision
        || this.utcOpenDay[source] !== dayStart
      ) return;
      this.drainUtcOpen(source, dayStart);
    }, delay);
  }

  drainUtcOpen(source: MarketSource, dayStart: number): void {
    if (
      !this.started
      || !this.fetchImpl
      || this.utcOpenRequests[source]
      || this.utcOpenDay[source] !== dayStart
    ) return;

    const now = this.now();
    const productIds: string[] = [];
    for (const productId of this.utcOpenPending[source]) {
      const product = this.productById.get(productId);
      const record = this.utcOpens[source][productId];
      if (
        product
        && sourceSupportsProduct(source, product)
        && (!record || record.dayStart !== dayStart)
        && now >= (this.utcOpenRetryAt[source][productId] || 0)
      ) productIds.push(productId);
    }
    for (const productId of productIds) this.utcOpenPending[source].delete(productId);
    if (productIds.length === 0) {
      this.scheduleUtcOpenRetry(source, dayStart);
      return;
    }

    const requestedProducts = productIds
      .map((id) => this.productById.get(id))
      .filter(Boolean) as Product[];
    const controller = new AbortController();
    const revision = this.revision;
    this.utcOpenControllers[source] = controller;
    const timeout = setTimeout(() => controller.abort(), this.utcOpenTimeoutMs);
    const request = this.fetchUtcOpens(source, dayStart, requestedProducts, controller)
      .then((opens) => this.commitUtcOpens(
        source,
        dayStart,
        opens,
        productIds,
        revision,
      ))
      .catch(() => this.deferUtcOpenRetry(source, dayStart, productIds, revision))
      .finally(() => {
        clearTimeout(timeout);
        if (this.utcOpenRequests[source] === request) {
          this.utcOpenRequests[source] = null;
          this.utcOpenControllers[source] = null;
          if (this.utcOpenPending[source].size > 0) {
            this.drainUtcOpen(source, dayStart);
          }
        }
      });
    this.utcOpenRequests[source] = request;
  }

  async fetchUtcOpens(
    source: MarketSource,
    dayStart: number,
    products: readonly Product[],
    controller: AbortController,
  ): Promise<Record<string, number | null>> {
    const options: RequestInit = {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    };

    if (source === "kraken") {
      const pairs = products.map((product) => product.krakenSymbol).filter(Boolean) as string[];
      if (pairs.length === 0) return {};
      const pair = encodeURIComponent(pairs.join(","));
      const response = await this.fetchImpl!(
        `${KRAKEN_TICKER_ROOT}?pair=${pair}&assetVersion=1`,
        options,
      );
      if (!response.ok) throw new Error(`Kraken UTC open ${response.status}`);
      return parseKrakenUtcOpens(await response.json(), products);
    }

    if (source === "bitstamp") {
      const endMs = Math.max(dayStart + 1_000, this.now());
      const startSeconds = Math.floor(dayStart / 1_000);
      const endSeconds = Math.floor(endMs / 1_000);
      const windowMs = Math.max(1_000, endMs - dayStart + 1);
      const results = await mapWithConcurrency<Product, [string, number | null]>(
        products,
        REST_CONCURRENCY,
        async (product) => {
        try {
          const marketSymbol = encodeURIComponent(product.bitstampSymbol as string);
          const url = `${BITSTAMP_API_ROOT}/ohlc/${marketSymbol}/`
            + `?step=${UTC_OPEN_GRANULARITY_SECONDS}&limit=24`
            + `&start=${startSeconds}&end=${endSeconds}`;
          const response = await this.fetchImpl!(url, options);
          if (!response.ok) throw new Error(`Bitstamp UTC open ${response.status}`);
          return [product.id, parseBitstampUtcOpen(await response.json(), dayStart, windowMs)];
        } catch {
          return [product.id, null];
        }
        },
      );
      return Object.fromEntries(results);
    }

    const endMs = Math.max(dayStart + 1_000, this.now());
    const start = encodeURIComponent(new Date(dayStart).toISOString());
    const end = encodeURIComponent(new Date(endMs).toISOString());
    const results = await mapWithConcurrency<Product, [string, number | null]>(
      products,
      REST_CONCURRENCY,
      async (product) => {
      try {
        const productId = encodeURIComponent(product.id);
        const url = `${COINBASE_API_ROOT}/${productId}/candles`
          + `?granularity=${UTC_OPEN_GRANULARITY_SECONDS}&start=${start}&end=${end}`;
        const response = await this.fetchImpl!(url, options);
        if (!response.ok) throw new Error(`Coinbase UTC open ${response.status}`);
        const windowMs = Math.max(1_000, endMs - dayStart + 1);
        return [product.id, parseCoinbaseUtcOpen(await response.json(), dayStart, windowMs)];
      } catch {
        return [product.id, null];
      }
      },
    );
    return Object.fromEntries(results);
  }

  commitUtcOpens(
    source: MarketSource,
    dayStart: number,
    opens: Readonly<Record<string, unknown>> | null,
    productIds: readonly string[],
    revision = this.revision,
  ): void {
    if (
      !this.started
      || revision !== this.revision
      || this.utcOpenDay[source] !== dayStart
    ) return;

    const missing: string[] = [];
    for (const productId of productIds) {
      if (!this.productById.has(productId)) continue;
      const price = positivePrice(opens && opens[productId]);
      if (price !== null) {
        this.utcOpens[source][productId] = { dayStart, price };
        this.utcOpenRetryAttempt[source][productId] = 0;
        this.utcOpenRetryAt[source][productId] = 0;
      } else {
        missing.push(productId);
      }
    }
    if (missing.length > 0) {
      this.deferUtcOpenRetry(source, dayStart, missing, revision);
    }
    this.emit();
  }

  deferUtcOpenRetry(
    source: MarketSource,
    dayStart: number,
    productIds: readonly string[] | null = null,
    revision = this.revision,
  ): void {
    if (
      !this.started
      || revision !== this.revision
      || this.utcOpenDay[source] !== dayStart
    ) return;
    const targets = productIds || sourceProductIds(source, this.products);
    for (const productId of targets) {
      if (!this.productById.has(productId)) continue;
      const attempt = this.utcOpenRetryAttempt[source][productId] || 0;
      this.utcOpenRetryAttempt[source][productId] = attempt + 1;
      this.utcOpenRetryAt[source][productId] = this.now() + this.utcOpenRetryDelay(attempt);
      this.utcOpenPending[source].add(productId);
    }
    this.scheduleUtcOpenRetry(source, dayStart, revision);
  }

  resolveProductId(asset: unknown): string | null {
    if (this.productById.has(asset as string)) return asset as string;
    return this.productIdBySymbol.get(asset as string) || null;
  }

  handleStreamUtcOpen(rawEvent: UtcOpenEvent): boolean {
    const productId = this.resolveProductId(rawEvent.asset);
    const product = productId ? this.productById.get(productId) : null;
    const source = utcOpenSource(rawEvent);
    const dayStart = utcDayStart(rawEvent.candleAt);
    const openPrice = positivePrice(rawEvent.openPrice);
    if (
      !product
      || !SOURCE_IDS.includes(source)
      || !sourceSupportsProduct(source, product)
      || dayStart === null
      || rawEvent.candleAt !== dayStart
      || dayStart !== utcDayStart(this.now())
      || openPrice === null
    ) return false;

    const trackedDay = this.utcOpenDay[source];
    if (trackedDay === null || dayStart > trackedDay) {
      this.resetUtcOpenDay(source, dayStart, rawEvent.candleAt);
    } else if (dayStart < trackedDay) {
      return false;
    }
    this.utcOpens[source][productId as string] = { dayStart, price: openPrice };
    this.utcOpenRetryAttempt[source][productId as string] = 0;
    this.utcOpenRetryAt[source][productId as string] = 0;
    this.utcOpenPending[source].delete(productId as string);
    return true;
  }

  handleQuotes(quotes: readonly HandledFeedEvent[]): void {
    const accepted: Quote[] = [];
    for (const rawQuote of quotes) {
      if (rawQuote && rawQuote.kind === "utcOpen") {
        this.handleStreamUtcOpen(rawQuote);
        continue;
      }
      const incoming = rawQuote as IncomingQuote;
      const productId = this.resolveProductId(incoming.asset);
      const product = productId ? this.productById.get(productId) : null;
      if (!product) continue;
      const marketSource = utcOpenSource(incoming);
      if (!SOURCE_IDS.includes(marketSource) || !sourceSupportsProduct(marketSource, product)) continue;
      if (!hasOwn(this.quotes[productId as string], incoming.source)) continue;
      const quote: Quote = { ...incoming, asset: productId as string, marketSource };
      this.quotes[productId as string][quote.source] = quote;
      accepted.push(quote);
    }
    if (accepted.length > 0) this.ensureSelectedUtcOpens();
    this.emit();
  }

  handleStatus(source: QuoteSource, status: SourceConnectionStatus): void {
    this.sourceStatus[source] = status;
    this.emit();
  }

  getState(): PriceFeedState {
    const now = this.now();
    const currentDayStart = utcDayStart(now);
    const prices = Object.fromEntries(
      this.products.map((product) => {
        const quote = selectQuote(this.quotes[product.id], now);
        if (!quote) return [product.id, null];
        const source = utcOpenSource(quote);
        const dayStart = utcDayStart(quote.exchangeAt);
        const record = this.utcOpens[source] && this.utcOpens[source][product.id];
        const changeUtc = dayStart === currentDayStart && record && record.dayStart === dayStart
          ? calculateUtcChange(quote.price, record.price)
          : null;
        return [product.id, { ...quote, changeUtc }];
      }),
    ) as Record<string, DisplayQuote | null>;
    const current = Object.values(prices).filter(Boolean) as DisplayQuote[];
    const fresh = current.filter((quote) => !quote.stale);
    const sourceStates = Object.values(this.sourceStatus);

    let status: FeedStatus;
    if (this.products.length > 0 && fresh.length === this.products.length) status = "live";
    else if (fresh.length > 0) status = "partial";
    else if (current.length > 0) status = "reconnecting";
    else if (sourceStates.some((state) => (
      state === "connecting" || state === "reconnecting" || state === "open"
    ))) status = "connecting";
    else status = "offline";

    return {
      status,
      prices,
      sources: { ...this.sourceStatus },
      lastUpdateAt: current.length > 0
        ? Math.max(...current.map((quote) => quote.receivedAt))
        : null,
    };
  }

  emit(): void {
    this.ensureSelectedUtcOpens();
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
