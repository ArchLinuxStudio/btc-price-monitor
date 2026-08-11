import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateUtcChange,
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

test("expands the Coinbase UTC-open window when the first five minutes are empty", async () => {
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

  assert.deepEqual(requestedMinutes.sort((a, b) => a - b), [5, 5, 30, 30]);
  assert.ok(Math.abs(feed.getState().prices.BTC.changeUtc - 10) < 1e-10);
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

test("prefers fresh Coinbase, then the freshest healthy fallback", () => {
  const now = 100_000;
  const coinbase = { price: 10, source: "coinbase", receivedAt: now - 3_000 };
  const kraken = { price: 11, source: "kraken", receivedAt: now - 100 };
  assert.equal(selectQuote({ coinbase, kraken }, now).source, "coinbase");

  coinbase.receivedAt = now - 7_000;
  assert.equal(selectQuote({ coinbase, kraken }, now).source, "kraken");
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
  assert.equal(feed.getState().prices.BTC.source, "coinbaseRest");
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
  assert.ok(Math.abs(feed.getState().prices.BTC.changeUtc - 10) < 1e-10);

  feed.handleQuotes([
    { asset: "BTC", price: 100, source: "kraken", sourceLabel: "Kraken", exchangeAt: now, receivedAt: now },
    { asset: "ETH", price: 50, source: "kraken", sourceLabel: "Kraken", exchangeAt: now, receivedAt: now },
  ]);
  await feed.utcOpenRequests.kraken;
  assert.ok(Math.abs(feed.getState().prices.BTC.changeUtc - 25) < 1e-10);
  assert.ok(Math.abs(feed.getState().prices.ETH.changeUtc - 25) < 1e-10);
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
  assert.ok(feed.getState().prices.BTC.changeUtc > 9.9);

  now = Date.parse("2026-08-12T00:00:03.000Z");
  feed.handleQuotes([
    { asset: "BTC", price: 120, source: "coinbase", sourceLabel: "Coinbase", exchangeAt: now, receivedAt: now },
  ]);
  const rolloverRequest = feed.utcOpenRequests.coinbase;
  assert.equal(feed.getState().prices.BTC.changeUtc, null);
  await rolloverRequest;
  assert.equal(feed.getState().prices.BTC.changeUtc, 0);
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
  assert.ok(feed.getState().prices.BTC.changeUtc > 9.9);

  now = Date.parse("2026-08-12T00:00:00.001Z");
  assert.equal(feed.getState().prices.BTC.changeUtc, null);
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
  assert.equal(feed.utcOpenRetryAttempt.coinbase, 1);
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

  assert.equal(feed.getState().prices.BTC.price, 101.25);
  assert.equal(feed.getState().prices.ETH, null);
  assert.equal(feed.restRequest, null);
  feed.started = false;
});
