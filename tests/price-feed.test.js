import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateUtcChange,
  createBitfinexTradesParser,
  parseBitstampMessage,
  parseBitstampUtcOpen,
  parseCoinbaseUtcOpen,
  PriceFeed,
  parseCoinbaseMessage,
  parseKrakenUtcOpens,
  parseKrakenMessage,
  parseRestTicker,
  reconnectDelay,
  selectQuote,
  utcDayStart,
} from "../src/price-feed.js";

const BTC_PRODUCT = {
  id: "BTC-USD",
  symbol: "BTC",
  name: "Bitcoin",
  krakenSymbol: "BTC/USD",
  bitstampSymbol: "btcusd",
  bitfinexSymbol: "tBTCUSD",
  fixed: true,
};
const ETH_PRODUCT = {
  id: "ETH-USD",
  symbol: "ETH",
  name: "Ethereum",
  krakenSymbol: "ETH/USD",
  bitstampSymbol: "ethusd",
  bitfinexSymbol: "tETHUSD",
  fixed: true,
};
const SOL_PRODUCT = {
  id: "SOL-USD",
  symbol: "SOL",
  name: "Solana",
  krakenSymbol: "SOL/USD",
  bitstampSymbol: "solusd",
  bitfinexSymbol: "tSOLUSD",
  fixed: false,
};
const DOGE_PRODUCT = {
  id: "DOGE-USD",
  symbol: "DOGE",
  name: "Dogecoin",
  krakenSymbol: null,
  bitstampSymbol: null,
  bitfinexSymbol: null,
  fixed: false,
};

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    this.sent = [];
    this.closeCode = null;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners[type] || []) listener(event);
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code = 1000) {
    if (this.readyState === 3) return;
    this.closeCode = code;
    this.readyState = 3;
    this.emit("close", { code });
  }
}

test("parses Coinbase Advanced Trade ticker payloads", () => {
  const quotes = parseCoinbaseMessage(JSON.stringify({
    channel: "ticker",
    timestamp: "2026-08-11T09:30:00.000Z",
    events: [{
      type: "update",
      tickers: [
        { product_id: "BTC-USD", price: "118642.38", price_percent_chg_24_h: "2.47" },
        { product_id: "ETH-USD", price: "4326.17", price_percent_chg_24_h: "-0.83" },
      ],
    }],
  }), 123);

  assert.equal(quotes.length, 2);
  assert.deepEqual(quotes.map(({ asset, price, source }) => ({ asset, price, source })), [
    { asset: "BTC", price: 118642.38, source: "coinbase" },
    { asset: "ETH", price: 4326.17, source: "coinbase" },
  ]);
  assert.equal(quotes[0].exchangeAt, Date.parse("2026-08-11T09:30:00.000Z"));
});

test("parses Kraken v2 ticker payloads", () => {
  const quotes = parseKrakenMessage(JSON.stringify({
    channel: "ticker",
    type: "update",
    data: [
      { symbol: "BTC/USD", last: 118600.1, change_pct: 2.2 },
      { symbol: "ETH/USD", last: 4300.2, change_pct: -0.4 },
    ],
  }), 456);

  assert.deepEqual(quotes.map(({ asset, price, source, receivedAt }) => ({ asset, price, source, receivedAt })), [
    { asset: "BTC", price: 118600.1, source: "kraken", receivedAt: 456 },
    { asset: "ETH", price: 4300.2, source: "kraken", receivedAt: 456 },
  ]);
});

test("parses mapped Bitstamp trades with the exchange microsecond timestamp", () => {
  const receivedAt = Date.parse("2026-08-22T09:30:01.000Z");
  const exchangeAt = Date.parse("2026-08-22T09:30:00.123Z");
  const quotes = parseBitstampMessage(JSON.stringify({
    event: "trade",
    channel: "live_trades_solusd",
    data: {
      price_str: "181.2500",
      microtimestamp: String(exchangeAt * 1_000 + 456),
      timestamp: String(Math.floor(exchangeAt / 1_000)),
    },
  }), receivedAt, new Map([["solusd", "SOL-USD"]]));

  assert.deepEqual(quotes, [{
    asset: "SOL-USD",
    price: 181.25,
    source: "bitstamp",
    marketSource: "bitstamp",
    transport: "ws",
    sourceLabel: "Bitstamp",
    exchangeAt,
    receivedAt,
  }]);
  assert.deepEqual(parseBitstampMessage(JSON.stringify({
    event: "trade",
    channel: "live_trades_dogeusd",
    data: { price: "0.25", timestamp: "1787391000" },
  }), receivedAt, new Map([["solusd", "SOL-USD"]])), []);
});

test("Bitfinex parser binds channel ids and handles trade snapshots, updates, and heartbeats", () => {
  const parser = createBitfinexTradesParser(new Map([["tSOLUSD", "SOL-USD"]]));
  const dayStart = Date.parse("2026-08-22T00:00:00.000Z");
  const receivedAt = dayStart + 20_000;

  assert.deepEqual(parser(JSON.stringify({
    event: "subscribed",
    channel: "trades",
    chanId: 41,
    symbol: "tSOLUSD",
  }), receivedAt), [{ kind: "subscriptionAck", key: "trades:tSOLUSD" }]);
  assert.deepEqual(parser(JSON.stringify([41, "hb"]), receivedAt), []);

  const snapshot = parser(JSON.stringify([41, [
    [1001, dayStart + 2_000, 2, "180.10"],
    [1002, dayStart + 4_000, -1, "181.20"],
    [1003, dayStart + 3_000, 1, "180.80"],
  ]]), receivedAt);
  assert.equal(snapshot.length, 1);
  assert.deepEqual(snapshot[0], {
    asset: "SOL-USD",
    price: 181.2,
    source: "bitfinex",
    marketSource: "bitfinex",
    transport: "ws",
    sourceLabel: "Bitfinex",
    exchangeAt: dayStart + 4_000,
    receivedAt: dayStart + 4_000,
  });

  assert.deepEqual(parser(JSON.stringify([
    41,
    "tu",
    [1004, dayStart + 5_000, -0.5, "182.50"],
  ]), receivedAt), [{
    asset: "SOL-USD",
    price: 182.5,
    source: "bitfinex",
    marketSource: "bitfinex",
    transport: "ws",
    sourceLabel: "Bitfinex",
    exchangeAt: dayStart + 5_000,
    receivedAt,
  }]);

  assert.deepEqual(parser(JSON.stringify({
    event: "subscribed",
    channel: "trades",
    chanId: 99,
    symbol: "tDOGEUSD",
  }), receivedAt), []);
  assert.deepEqual(parser(JSON.stringify([
    99,
    "tu",
    [1005, dayStart + 6_000, 1, "0.25"],
  ]), receivedAt), []);
  assert.deepEqual(parser("not json", receivedAt), []);
});

test("Bitfinex parser exposes mapped UTC daily candle snapshots and updates", () => {
  const parser = createBitfinexTradesParser(new Map([["tBTCUSD", "BTC-USD"]]));
  const dayStart = Date.parse("2026-08-22T00:00:00.000Z");
  assert.deepEqual(parser(JSON.stringify({
    event: "subscribed",
    channel: "candles",
    chanId: 52,
    key: "trade:1D:tBTCUSD",
  }), dayStart + 10_000), [{
    kind: "subscriptionAck",
    key: "candles:trade:1D:tBTCUSD",
  }]);

  assert.deepEqual(parser(JSON.stringify([52, [
    [dayStart - 86_400_000, 100, 110, 120, 90, 5],
    [dayStart, "115.50", 118, 120, 110, 4],
  ]]), dayStart + 10_000), [{
    kind: "utcOpen",
    asset: "BTC-USD",
    source: "bitfinex",
    marketSource: "bitfinex",
    candleAt: dayStart,
    openPrice: 115.5,
  }]);
  assert.deepEqual(parser(JSON.stringify([52, "hb"]), dayStart + 11_000), []);
  assert.deepEqual(parser(JSON.stringify([
    52,
    [dayStart, "116.25", 119, 121, 111, 5],
  ]), dayStart + 12_000), [{
    kind: "utcOpen",
    asset: "BTC-USD",
    source: "bitfinex",
    marketSource: "bitfinex",
    candleAt: dayStart,
    openPrice: 116.25,
  }]);
});

test("Bitfinex parser reports subscription errors without accepting unknown acknowledgements", () => {
  const parser = createBitfinexTradesParser(new Map([["tBTCUSD", "BTC-USD"]]));
  assert.deepEqual(parser(JSON.stringify({
    event: "subscribed",
    channel: "trades",
    chanId: 99,
    symbol: "tDOGEUSD",
  })), []);
  assert.deepEqual(parser(JSON.stringify({
    event: "error",
    code: 10301,
    msg: "Already subscribed",
  })), [{
    kind: "subscriptionError",
    code: 10301,
    message: "Already subscribed",
  }]);
});

test("ignores malformed and unrelated messages", () => {
  assert.deepEqual(parseCoinbaseMessage("not json"), []);
  assert.deepEqual(parseCoinbaseMessage(JSON.stringify({ channel: "heartbeats" })), []);
  assert.deepEqual(parseKrakenMessage(JSON.stringify({ channel: "status", data: [] })), []);
});

test("parses the HTTPS fallback ticker without inventing a daily change", () => {
  const quote = parseRestTicker("BTC", {
    price: "118700.55",
    time: "2026-08-11T09:31:00.000Z",
  }, 789);
  assert.equal(quote.price, 118700.55);
  assert.equal(quote.source, "coinbaseRest");
  assert.equal(quote.receivedAt, Date.parse("2026-08-11T09:31:00.000Z"));
  assert.equal(Object.prototype.hasOwnProperty.call(quote, "change24h"), false);
});

test("calculates day boundaries and changes against UTC midnight", () => {
  const timestamp = Date.parse("2026-08-11T23:59:59.999Z");
  assert.equal(utcDayStart(timestamp), Date.parse("2026-08-11T00:00:00.000Z"));
  assert.equal(calculateUtcChange(110, 100), 10.000000000000009);
  assert.equal(calculateUtcChange(90, 100), -9.999999999999998);
  assert.equal(calculateUtcChange(100, 0), null);
});

test("finds the first Coinbase trade candle after 00:00 UTC", () => {
  const dayStart = Date.parse("2026-08-11T00:00:00.000Z");
  const seconds = dayStart / 1_000;
  const payload = [
    [seconds + 180, 1, 2, "103.00", 104, 5],
    [seconds - 60, 1, 2, "99.00", 100, 5],
    [seconds, 1, 2, "100.25", 101, 5],
    [seconds + 300, 1, 2, "105.00", 106, 5],
  ];
  assert.equal(parseCoinbaseUtcOpen(payload, dayStart), 100.25);
  assert.equal(parseCoinbaseUtcOpen({ candles: payload }, dayStart), null);
});

test("finds the first valid Bitstamp hourly candle in the UTC day", () => {
  const dayStart = Date.parse("2026-08-22T00:00:00.000Z");
  const seconds = dayStart / 1_000;
  const payload = {
    data: {
      ohlc: [
        { timestamp: String(seconds + 7_200), open: "182.00", volume: "3" },
        { timestamp: String(seconds - 3_600), open: "170.00", volume: "2" },
        { timestamp: String(seconds + 3_600), open: "180.25", volume: "1" },
        { timestamp: String(seconds + 60), open: "179.00", volume: "0" },
        { timestamp: String(seconds + 120), open: "0", volume: "1" },
      ],
    },
  };

  assert.equal(parseBitstampUtcOpen(payload, dayStart), 180.25);
  assert.equal(parseBitstampUtcOpen({ data: { ohlc: "bad" } }, dayStart), null);
  assert.equal(parseBitstampUtcOpen(null, dayStart), null);
});

test("queries the Coinbase UTC open with one-hour candles through the current time", async () => {
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  const dayStartSeconds = dayStart / 1_000;
  const requestedMinutes = [];
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      const start = Date.parse(parsedUrl.searchParams.get("start"));
      const end = Date.parse(parsedUrl.searchParams.get("end"));
      const minutes = (end - start) / 60_000;
      requestedMinutes.push(minutes);
      return {
        ok: true,
        json: async () => minutes < 30
          ? []
          : [[dayStartSeconds + 600, 100, 100, 100, 100, 1]],
      };
    },
  });
  feed.started = true;
  feed.handleQuotes([
    { asset: "BTC", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;

  assert.deepEqual(requestedMinutes, [720]);
  assert.ok(Math.abs(feed.getState().prices["BTC-USD"].changeUtc - 10) < 1e-10);
  feed.stop();
});

test("parses Kraken UTC-day opens in modern and legacy result keys", () => {
  assert.deepEqual(parseKrakenUtcOpens({
    error: [],
    result: {
      "BTC/USD": { o: "100.50" },
      XETHZUSD: { o: "20.25" },
    },
  }), { BTC: 100.5, ETH: 20.25 });
  assert.deepEqual(parseKrakenUtcOpens({ error: ["rate limited"], result: {} }), {
    BTC: null,
    ETH: null,
  });
});

test("prefers fresh Coinbase, then the freshest healthy exchange fallback", () => {
  const now = 100_000;
  const coinbase = { price: 10, source: "coinbase", receivedAt: now - 3_000 };
  const kraken = { price: 11, source: "kraken", receivedAt: now - 100 };
  const bitstamp = { price: 12, source: "bitstamp", receivedAt: now - 50 };
  const bitfinex = { price: 13, source: "bitfinex", receivedAt: now - 25 };
  assert.equal(selectQuote({ coinbase, kraken, bitstamp, bitfinex }, now).source, "coinbase");

  coinbase.receivedAt = now - 7_000;
  assert.equal(selectQuote({ coinbase, kraken, bitstamp, bitfinex }, now).source, "bitfinex");

  bitfinex.receivedAt = now - 13_000;
  assert.equal(selectQuote({ coinbase, kraken, bitstamp, bitfinex }, now).source, "bitstamp");

  const coinbaseRest = { price: 14, source: "coinbaseRest", receivedAt: now };
  assert.equal(
    selectQuote({ coinbase, kraken, bitstamp, bitfinex, coinbaseRest }, now).source,
    "bitstamp",
  );
});

test("retains the newest quote but marks it stale after an outage", () => {
  const now = 100_000;
  const selected = selectQuote({
    coinbase: { price: 10, source: "coinbase", receivedAt: now - 20_000 },
    kraken: { price: 11, source: "kraken", receivedAt: now - 15_000 },
  }, now);
  assert.equal(selected.source, "kraken");
  assert.equal(selected.stale, true);
});

test("reconnect backoff is bounded and jittered", () => {
  assert.equal(reconnectDelay(0, () => 0.5), 500);
  assert.equal(reconnectDelay(4, () => 0.5), 8_000);
  assert.equal(reconnectDelay(99, () => 0.5), 30_000);
  assert.ok(reconnectDelay(2, () => 0) < reconnectDelay(2, () => 1));
});

test("HTTPS fallback keeps polling while WebSocket quotes are unavailable", async () => {
  let tickerRequestCount = 0;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => 100_000,
    fetchImpl: async (url) => {
      if (url.endsWith("/ticker")) tickerRequestCount += 1;
      return {
        ok: true,
        json: async () => ({
          price: url.includes("BTC") ? "100.10" : "20.20",
          time: "2026-08-11T09:30:00.000Z",
        }),
      };
    },
  });
  feed.started = true;

  await feed.pollRestFallback();
  await feed.pollRestFallback();

  assert.equal(tickerRequestCount, 4);
  assert.equal(feed.getState().prices["BTC-USD"].source, "coinbaseRest");
  feed.started = false;
});

test("binds the runtime fetch method before using it in a WebView", async () => {
  const originalFetch = globalThis.fetch;
  let observedThis = null;
  globalThis.fetch = function fakeWindowFetch() {
    observedThis = this;
    return Promise.resolve({ ok: false, status: 503 });
  };

  try {
    const feed = new PriceFeed({
      WebSocketImpl: class {},
      now: () => Date.parse("2026-08-11T12:00:00.000Z"),
    });
    feed.started = true;
    await feed.pollRestFallback();
    assert.equal(observedThis, globalThis);
    feed.stop();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("computes UTC change with the selected quote's own exchange open", async () => {
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  const dayStartSeconds = dayStart / 1_000;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    fetchImpl: async (url) => {
      if (url.includes("api.kraken.com")) {
        return {
          ok: true,
          json: async () => ({
            error: [],
            result: {
              "BTC/USD": { o: "80" },
              "ETH/USD": { o: "40" },
            },
          }),
        };
      }
      const open = url.includes("BTC-USD") ? 100 : 50;
      return {
        ok: true,
        json: async () => [[dayStartSeconds, open, open, open, open, 1]],
      };
    },
  });
  feed.started = true;

  feed.handleQuotes([
    { asset: "BTC", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now - 6_000 },
    { asset: "ETH", price: 55, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now - 6_000 },
  ]);
  await feed.utcOpenRequests.coinbase;
  assert.ok(Math.abs(feed.getState().prices["BTC-USD"].changeUtc - 10) < 1e-10);

  feed.handleQuotes([
    { asset: "BTC", price: 100, source: "kraken", sourceLabel: "Kraken", exchangeAt: now, receivedAt: now },
    { asset: "ETH", price: 50, source: "kraken", sourceLabel: "Kraken", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.kraken;
  assert.ok(Math.abs(feed.getState().prices["BTC-USD"].changeUtc - 25) < 1e-10);
  assert.ok(Math.abs(feed.getState().prices["ETH-USD"].changeUtc - 25) < 1e-10);
  feed.stop();
});

test("queries Bitstamp's mapped OHLC URL and computes change from its own UTC open", async () => {
  const now = Date.parse("2026-08-22T12:34:56.000Z");
  const dayStart = utcDayStart(now);
  const urls = [];
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products: [SOL_PRODUCT],
    fetchImpl: async (url) => {
      urls.push(new URL(url));
      return {
        ok: true,
        json: async () => ({
          data: {
            ohlc: [
              {
                timestamp: String((dayStart + 8 * 3_600_000) / 1_000),
                open: "105",
                volume: "2",
              },
              {
                timestamp: String((dayStart + 7 * 3_600_000) / 1_000),
                open: "100",
                volume: "1",
              },
            ],
          },
        }),
      };
    },
  });
  feed.started = true;
  feed.handleQuotes([{
    asset: "SOL-USD",
    price: 110,
    source: "bitstamp",
    marketSource: "bitstamp",
    sourceLabel: "Bitstamp",
    exchangeAt: now,
    receivedAt: now,
  }]);
  await feed.utcOpenRequests.bitstamp;

  assert.equal(urls.length, 1);
  assert.equal(urls[0].origin, "https://www.bitstamp.net");
  assert.equal(urls[0].pathname, "/api/v2/ohlc/solusd/");
  assert.equal(urls[0].searchParams.get("step"), "3600");
  assert.equal(urls[0].searchParams.get("limit"), "24");
  assert.equal(Number(urls[0].searchParams.get("start")), dayStart / 1_000);
  assert.equal(Number(urls[0].searchParams.get("end")), now / 1_000);
  assert.equal(feed.getState().prices["SOL-USD"].source, "bitstamp");
  assert.ok(Math.abs(feed.getState().prices["SOL-USD"].changeUtc - 10) < 1e-10);
  feed.stop();
});

test("uses Bitfinex's same-socket daily candle for its own UTC change without REST", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  let fetchCalls = 0;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products: [BTC_PRODUCT],
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("Bitfinex REST must not be used");
    },
  });
  const parser = feed.connections.find((connection) => (
    connection.config.id === "bitfinex"
  )).config.parser;
  feed.started = true;

  parser(JSON.stringify({
    event: "subscribed",
    channel: "candles",
    chanId: 61,
    key: "trade:1D:tBTCUSD",
  }), now);
  parser(JSON.stringify({
    event: "subscribed",
    channel: "trades",
    chanId: 62,
    symbol: "tBTCUSD",
  }), now);
  feed.handleQuotes(parser(JSON.stringify([
    61,
    [dayStart, "120", 125, 130, 115, 50],
  ]), now));
  feed.handleQuotes(parser(JSON.stringify([
    62,
    "tu",
    [1001, now, 0.1, "126"],
  ]), now));

  const quote = feed.getState().prices["BTC-USD"];
  assert.equal(fetchCalls, 0);
  assert.equal(quote.source, "bitfinex");
  assert.equal(quote.changeUtc, 5.000000000000004);
  assert.deepEqual(feed.utcOpens.bitfinex["BTC-USD"], { dayStart, price: 120 });
  feed.stop();
});

test("invalidates yesterday's open immediately at the UTC day rollover", async () => {
  let now = Date.parse("2026-08-11T23:59:59.000Z");
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    fetchImpl: async (url) => {
      const start = new URL(url).searchParams.get("start");
      const dayStartSeconds = Date.parse(start) / 1_000;
      const open = start.startsWith("2026-08-12") ? 120 : 100;
      return { ok: true, json: async () => [[dayStartSeconds, open, open, open, open, 1]] };
    },
  });
  feed.started = true;
  feed.handleQuotes([
    { asset: "BTC", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;
  assert.ok(feed.getState().prices["BTC-USD"].changeUtc > 9.9);

  now = Date.parse("2026-08-12T00:00:03.000Z");
  feed.handleQuotes([
    { asset: "BTC", price: 120, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  const rolloverRequest = feed.utcOpenRequests.coinbase;
  assert.equal(feed.getState().prices["BTC-USD"].changeUtc, null);
  await rolloverRequest;
  assert.equal(feed.getState().prices["BTC-USD"].changeUtc, 0);
  feed.stop();
});

test("hides yesterday's change at UTC midnight even before a new quote arrives", async () => {
  let now = Date.parse("2026-08-11T23:59:59.000Z");
  const dayStartSeconds = utcDayStart(now) / 1_000;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [[dayStartSeconds, 100, 100, 100, 100, 1]],
    }),
  });
  feed.started = true;
  feed.handleQuotes([
    { asset: "BTC", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;
  assert.ok(feed.getState().prices["BTC-USD"].changeUtc > 9.9);

  now = Date.parse("2026-08-12T00:00:00.001Z");
  assert.equal(feed.getState().prices["BTC-USD"].changeUtc, null);
  feed.stop();
});

test("times out a stuck UTC-open request so later quotes can retry", async () => {
  const now = Date.parse("2026-08-11T12:00:00.000Z");
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    utcOpenTimeoutMs: 5,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });
  feed.started = true;
  feed.handleQuotes([
    { asset: "BTC", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;

  assert.equal(feed.utcOpenRequests.coinbase, null);
  assert.equal(feed.utcOpenControllers.coinbase, null);
  assert.equal(feed.utcOpenRetryAttempt.coinbase["BTC-USD"], 1);
  feed.stop();
});

test("HTTPS fallback preserves one asset when the sibling request fails", async () => {
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => 200_000,
    fetchImpl: async (url) => {
      if (url.includes("ETH")) throw new Error("simulated ETH endpoint failure");
      return {
        ok: true,
        json: async () => ({ price: "101.25", time: "2026-08-11T09:31:00.000Z" }),
      };
    },
  });
  feed.started = true;

  await feed.pollRestFallback();

  assert.equal(feed.getState().prices["BTC-USD"].price, 101.25);
  assert.equal(feed.getState().prices["ETH-USD"], null);
  assert.equal(feed.restRequest, null);
  feed.started = false;
});

test("caps each free REST batch at three concurrent requests", async () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const products = [BTC_PRODUCT, ETH_PRODUCT].concat(
    ["SOL", "DOGE", "ADA", "XRP", "LTC", "AVAX"].map((symbol) => ({
      id: `${symbol}-USD`,
      symbol,
      name: symbol,
      krakenSymbol: null,
      bitstampSymbol: null,
      bitfinexSymbol: null,
      fixed: false,
    })),
  );
  let activeRequests = 0;
  let peakRequests = 0;
  let requestCount = 0;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products,
    fetchImpl: async (url) => {
      requestCount += 1;
      activeRequests += 1;
      peakRequests = Math.max(peakRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 3));
      activeRequests -= 1;
      return {
        ok: true,
        json: async () => (url.endsWith("/ticker")
          ? { price: "100", time: new Date(now).toISOString() }
          : [[utcDayStart(now) / 1_000, 100, 100, 100, 100, 1]]),
      };
    },
  });
  feed.started = true;

  await feed.pollRestFallback();
  await feed.utcOpenRequests.coinbase;

  assert.equal(requestCount, 16);
  assert.equal(peakRequests, 3);
  feed.stop();
});

test("maps dynamically subscribed Coinbase and Kraken products to product ids", () => {
  const coinbaseQuotes = parseCoinbaseMessage(JSON.stringify({
    channel: "ticker",
    timestamp: "2026-08-22T09:30:00.000Z",
    events: [{
      tickers: [
        { product_id: "SOL-USD", price: "181.25" },
        { product_id: "DOGE-USD", price: "0.25" },
      ],
    }],
  }), 100, new Map([["SOL-USD", "SOL-USD"]]));
  assert.deepEqual(coinbaseQuotes.map((quote) => quote.asset), ["SOL-USD"]);

  const krakenQuotes = parseKrakenMessage(JSON.stringify({
    channel: "ticker",
    data: [
      { symbol: "SOL/USD", last: "180.75" },
      { symbol: "DOGE/USD", last: "0.24" },
    ],
  }), 200, new Map([["SOL/USD", "SOL-USD"]]));
  assert.deepEqual(krakenQuotes.map((quote) => quote.asset), ["SOL-USD"]);
});

test("builds dynamic subscriptions and safely rebuilds them in setProducts", () => {
  FakeWebSocket.instances = [];
  const feed = new PriceFeed({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: null,
    products: [BTC_PRODUCT, ETH_PRODUCT, SOL_PRODUCT, DOGE_PRODUCT],
  });
  feed.start();

  assert.equal(FakeWebSocket.instances.length, 4);
  for (const socket of FakeWebSocket.instances) socket.open();
  const originalSockets = [...FakeWebSocket.instances];
  const coinbaseSocket = FakeWebSocket.instances.find((socket) => (
    socket.url.includes("coinbase")
  ));
  const krakenSocket = FakeWebSocket.instances.find((socket) => socket.url.includes("kraken"));
  const bitstampSocket = FakeWebSocket.instances.find((socket) => socket.url.includes("bitstamp"));
  const bitfinexSocket = FakeWebSocket.instances.find((socket) => socket.url.includes("bitfinex"));
  assert.deepEqual(coinbaseSocket.sent[0].product_ids, [
    "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD",
  ]);
  assert.deepEqual(krakenSocket.sent[0].params.symbol, ["BTC/USD", "ETH/USD", "SOL/USD"]);
  assert.deepEqual(bitstampSocket.sent.map((message) => message.data.channel), [
    "live_trades_btcusd",
    "live_trades_ethusd",
    "live_trades_solusd",
  ]);
  assert.deepEqual(
    bitfinexSocket.sent
      .filter((message) => message.channel === "trades")
      .map((message) => message.symbol),
    ["tBTCUSD", "tETHUSD", "tSOLUSD"],
  );
  assert.deepEqual(
    bitfinexSocket.sent
      .filter((message) => message.channel === "candles")
      .map((message) => message.key),
    ["trade:1D:tBTCUSD", "trade:1D:tETHUSD", "trade:1D:tSOLUSD"],
  );
  assert.equal(JSON.stringify(bitstampSocket.sent).includes("DOGE"), false);
  assert.equal(JSON.stringify(bitfinexSocket.sent).includes("DOGE"), false);

  feed.handleQuotes([{
    asset: "BTC-USD",
    price: 100,
    source: "coinbase",
    sourceLabel: "Coinbase",
    exchangeAt: Date.now(),
    receivedAt: Date.now(),
  }]);
  feed.setProducts([
    BTC_PRODUCT,
    ETH_PRODUCT,
    {
      ...SOL_PRODUCT,
      krakenSymbol: null,
      bitstampSymbol: null,
      bitfinexSymbol: null,
    },
    DOGE_PRODUCT,
  ]);

  assert.equal(FakeWebSocket.instances.length, 8);
  assert.equal(originalSockets.every((socket) => socket.readyState === 3), true);
  assert.equal(feed.getState().prices["BTC-USD"].price, 100);
  const configById = Object.fromEntries(feed.connections.map((connection) => [
    connection.config.id,
    connection.config,
  ]));
  assert.deepEqual(configById.coinbase.subscriptions[0].product_ids, [
    "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD",
  ]);
  assert.deepEqual(configById.kraken.subscriptions[0].params.symbol, [
    "BTC/USD",
    "ETH/USD",
  ]);
  assert.deepEqual(configById.bitstamp.subscriptions.map((message) => message.data.channel), [
    "live_trades_btcusd",
    "live_trades_ethusd",
  ]);
  assert.deepEqual(
    configById.bitfinex.subscriptions
      .filter((message) => message.channel === "trades")
      .map((message) => message.symbol),
    ["tBTCUSD", "tETHUSD"],
  );
  feed.stop();
});

test("Bitfinex requires every unique trade and candle acknowledgement", async () => {
  FakeWebSocket.instances = [];
  const feed = new PriceFeed({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: null,
    products: [BTC_PRODUCT],
  });
  const connection = feed.connections.find((entry) => entry.config.id === "bitfinex");
  connection.config.subscriptionAckTimeoutMs = 20;
  feed.start();
  const socket = FakeWebSocket.instances.find((entry) => entry.url.includes("bitfinex"));
  socket.open();

  const tradeAck = JSON.stringify({
    event: "subscribed",
    channel: "trades",
    chanId: 41,
    symbol: "tBTCUSD",
  });
  socket.emit("message", { data: tradeAck });
  socket.emit("message", { data: tradeAck });
  assert.deepEqual([...connection.pendingSubscriptionAcks], ["candles:trade:1D:tBTCUSD"]);
  socket.emit("message", { data: JSON.stringify({
    event: "subscribed",
    channel: "candles",
    chanId: 42,
    key: "trade:1D:tBTCUSD",
  }) });

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(connection.pendingSubscriptionAcks.size, 0);
  assert.equal(connection.subscriptionAckTimer, null);
  assert.equal(socket.readyState, 1);
  feed.stop();
});

test("Bitfinex reconnects when a subscription is rejected or never acknowledged", async () => {
  FakeWebSocket.instances = [];
  const rejectedFeed = new PriceFeed({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: null,
    products: [BTC_PRODUCT],
  });
  rejectedFeed.start();
  const rejectedSocket = FakeWebSocket.instances.find((entry) => entry.url.includes("bitfinex"));
  rejectedSocket.open();
  rejectedSocket.emit("message", { data: JSON.stringify({
    event: "error",
    code: 10300,
    msg: "Subscription failed",
  }) });
  assert.equal(rejectedSocket.closeCode, 4003);
  rejectedFeed.stop();

  FakeWebSocket.instances = [];
  const timeoutFeed = new PriceFeed({
    WebSocketImpl: FakeWebSocket,
    fetchImpl: null,
    products: [BTC_PRODUCT],
  });
  const timeoutConnection = timeoutFeed.connections.find((entry) => (
    entry.config.id === "bitfinex"
  ));
  timeoutConnection.config.subscriptionAckTimeoutMs = 5;
  timeoutFeed.start();
  const timeoutSocket = FakeWebSocket.instances.find((entry) => entry.url.includes("bitfinex"));
  timeoutSocket.open();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(timeoutSocket.closeCode, 4003);
  timeoutFeed.stop();
});

test("does not let a quiet custom product fail the shared socket watchdog", () => {
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    fetchImpl: null,
    products: [BTC_PRODUCT, ETH_PRODUCT, SOL_PRODUCT],
  });
  const connection = feed.connections[0];
  connection.openedAt = 1_000;
  connection.lastQuoteAt["BTC-USD"] = 29_000;
  connection.lastQuoteAt["ETH-USD"] = 29_000;
  connection.lastQuoteAt["SOL-USD"] = 0;

  assert.equal(connection.hasExpiredSentinelQuotes(30_000), false);
  connection.lastQuoteAt["ETH-USD"] = 5_000;
  assert.equal(connection.hasExpiredSentinelQuotes(30_000), true);
});

test("REST fallback requests only products whose WebSocket quote is missing or stale", async () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  const tickerUrls = [];
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products: [BTC_PRODUCT, ETH_PRODUCT, SOL_PRODUCT],
    fetchImpl: async (url) => {
      if (url.includes("/candles")) {
        return { ok: true, json: async () => [[dayStart / 1_000, 1, 1, 1, 1, 1]] };
      }
      tickerUrls.push(url);
      return {
        ok: true,
        json: async () => ({ price: "180.50", time: "2026-08-22T12:00:00.000Z" }),
      };
    },
  });
  feed.started = true;
  for (const id of ["BTC-USD", "ETH-USD"]) {
    feed.quotes[id].coinbase = {
      asset: id,
      price: id === "BTC-USD" ? 115_000 : 4_500,
      source: "coinbase",
      sourceLabel: "Coinbase",
      exchangeAt: now,
      receivedAt: now,
    };
  }

  await feed.pollRestFallback();
  if (feed.utcOpenRequests.coinbase) await feed.utcOpenRequests.coinbase;

  assert.equal(tickerUrls.length, 1);
  assert.match(tickerUrls[0], /SOL-USD\/ticker$/);
  assert.equal(feed.getState().prices["SOL-USD"].price, 180.5);
  feed.stop();
});

test("finds a Coinbase UTC open whose first trade is later than five hours", async () => {
  const now = Date.parse("2026-08-22T20:00:00.000Z");
  const dayStart = utcDayStart(now);
  const requests = [];
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products: [SOL_PRODUCT],
    fetchImpl: async (url) => {
      requests.push(new URL(url));
      return {
        ok: true,
        json: async () => [
          [(dayStart + 12 * 60 * 60_000) / 1_000, 2, 2, 2, 2, 1],
          [(dayStart + 7 * 60 * 60_000) / 1_000, 1, 1, 1, 1, 1],
          [(dayStart - 60 * 60_000) / 1_000, 0.5, 0.5, 0.5, 0.5, 1],
        ],
      };
    },
  });
  feed.started = true;
  feed.handleQuotes([{
    asset: "SOL-USD",
    price: 2,
    source: "coinbase",
    sourceLabel: "Coinbase",
    exchangeAt: now,
    receivedAt: now,
  }]);
  await feed.utcOpenRequests.coinbase;

  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get("granularity"), "3600");
  assert.equal(Date.parse(requests[0].searchParams.get("start")), dayStart);
  assert.equal(Date.parse(requests[0].searchParams.get("end")), now);
  assert.equal(feed.getState().prices["SOL-USD"].changeUtc, 100);
  feed.stop();
});

test("retries only the product whose UTC open is still missing", async () => {
  let now = Date.parse("2026-08-22T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  const requestCounts = { "BTC-USD": 0, "ETH-USD": 0 };
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => now,
    products: [BTC_PRODUCT, ETH_PRODUCT],
    fetchImpl: async (url) => {
      const id = url.includes("BTC-USD") ? "BTC-USD" : "ETH-USD";
      requestCounts[id] += 1;
      const hasOpen = id === "BTC-USD" || requestCounts[id] > 1;
      return {
        ok: true,
        json: async () => hasOpen
          ? [[dayStart / 1_000, 100, 100, 100, 100, 1]]
          : [],
      };
    },
  });
  feed.started = true;
  feed.handleQuotes([
    { asset: "BTC-USD", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
    { asset: "ETH-USD", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;
  assert.deepEqual(requestCounts, { "BTC-USD": 1, "ETH-USD": 1 });

  now += 3_000;
  feed.handleQuotes([
    { asset: "ETH-USD", price: 110, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.coinbase;

  assert.deepEqual(requestCounts, { "BTC-USD": 1, "ETH-USD": 2 });
  assert.ok(feed.utcOpens.coinbase["BTC-USD"]);
  assert.ok(feed.utcOpens.coinbase["ETH-USD"]);
  feed.stop();
});

test("retries a missing UTC open after backoff without waiting for another quote", async () => {
  const now = Date.now();
  const dayStart = utcDayStart(now);
  let candleRequests = 0;
  let signalRetry;
  const retryStarted = new Promise((resolve) => {
    signalRetry = resolve;
  });
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => Date.now(),
    products: [SOL_PRODUCT],
    utcOpenRetryDelayImpl: () => 5,
    fetchImpl: async () => {
      candleRequests += 1;
      if (candleRequests === 1) {
        return { ok: true, json: async () => [] };
      }
      signalRetry();
      return {
        ok: true,
        json: async () => [[dayStart / 1_000, 1, 1, 1, 1, 1]],
      };
    },
  });
  feed.started = true;
  feed.handleQuotes([{
    asset: "SOL-USD",
    price: 2,
    source: "coinbase",
    sourceLabel: "Coinbase",
    exchangeAt: now,
    receivedAt: now,
  }]);
  const initialRequest = feed.utcOpenRequests.coinbase;
  await initialRequest;

  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error("UTC open retry did not start")), 500);
    retryStarted.then(() => {
      clearTimeout(guard);
      resolve();
    }, reject);
  });
  if (feed.utcOpenRequests.coinbase) await feed.utcOpenRequests.coinbase;

  assert.equal(candleRequests, 2);
  assert.equal(feed.utcOpens.coinbase["SOL-USD"].price, 1);
  feed.stop();
});

test("setProducts revision prevents a removed product's old UTC request from writing back", async () => {
  FakeWebSocket.instances = [];
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const dayStart = utcDayStart(now);
  let resolveCandle;
  const feed = new PriceFeed({
    WebSocketImpl: FakeWebSocket,
    now: () => now,
    products: [BTC_PRODUCT, ETH_PRODUCT, SOL_PRODUCT],
    fetchImpl: async (url) => {
      if (!url.includes("SOL-USD/candles")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return new Promise((resolve) => {
        resolveCandle = resolve;
      });
    },
  });
  feed.started = true;
  feed.handleQuotes([{
    asset: "SOL-USD",
    price: 2,
    source: "coinbase",
    sourceLabel: "Coinbase",
    exchangeAt: now,
    receivedAt: now,
  }]);
  const oldRequest = feed.utcOpenRequests.coinbase;
  feed.fetchImpl = null;
  feed.setProducts([BTC_PRODUCT, ETH_PRODUCT]);
  resolveCandle({
    ok: true,
    json: async () => [[dayStart / 1_000, 1, 1, 1, 1, 1]],
  });
  await oldRequest;

  assert.deepEqual(Object.keys(feed.getState().prices), ["BTC-USD", "ETH-USD"]);
  assert.equal(Object.prototype.hasOwnProperty.call(feed.utcOpens.coinbase, "SOL-USD"), false);
  feed.stop();
});
