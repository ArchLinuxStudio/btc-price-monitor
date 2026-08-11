import test from "node:test";
import assert from "node:assert/strict";

import {
  PriceFeed,
  parseCoinbaseMessage,
  parseKrakenMessage,
  parseRestTicker,
  reconnectDelay,
  selectQuote,
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
  assert.deepEqual(quotes.map(({ asset, price, change24h, source }) => ({ asset, price, change24h, source })), [
    { asset: "BTC", price: 118642.38, change24h: 2.47, source: "coinbase" },
    { asset: "ETH", price: 4326.17, change24h: -0.83, source: "coinbase" },
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

test("parses the HTTPS fallback ticker without inventing 24h change", () => {
  const quote = parseRestTicker("BTC", {
    price: "118700.55",
    time: "2026-08-11T09:31:00.000Z",
  }, 789);
  assert.equal(quote.price, 118700.55);
  assert.equal(quote.source, "coinbaseRest");
  assert.equal(quote.change24h, null);
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
  let requestCount = 0;
  const feed = new PriceFeed({
    WebSocketImpl: class {},
    now: () => 100_000,
    fetchImpl: async (url) => {
      requestCount += 1;
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

  assert.equal(requestCount, 4);
  assert.equal(feed.getState().prices.BTC.source, "coinbaseRest");
  feed.started = false;
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
