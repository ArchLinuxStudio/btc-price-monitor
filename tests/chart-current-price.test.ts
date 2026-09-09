import test from "node:test";
import assert from "node:assert/strict";

import { ChartCurrentPrice } from "../src/chart-current-price.ts";
import type { ChartCurrentPriceState } from "../src/chart-current-price.ts";
import { createExactPriceSocket } from "../src/price-feed.ts";
import type { FetchResponseLike, MarketSource, Quote } from "../src/price-feed.ts";
import type { Product } from "../src/watchlist.ts";

const NOW = Date.UTC(2026, 8, 9, 12);
const spot: Product = {
  id: "BTC-USD", symbol: "BTC", name: "Bitcoin", fixed: true,
  krakenSymbol: "BTC/USD", bitstampSymbol: "btcusd", bitfinexSymbol: "tBTCUSD",
};
const perpetual: Product = {
  id: "AMD-USDT-PERP", symbol: "AMD.P", name: "AMD", fixed: false,
  krakenSymbol: null, bitstampSymbol: null, bitfinexSymbol: null,
  bybitSymbol: "AMDSTOCKUSDT", gateSymbol: "AMD_USDT",
  marketType: "perpetual", quoteCurrency: "USDT", assetClass: "equity",
};

class FakeSocket {
  static instances: FakeSocket[] = [];
  readonly url: string;
  readyState = 0;
  sent: unknown[] = [];
  private listeners: Record<string, Array<(event: { data?: unknown }) => void>> = {};
  constructor(url: string) { this.url = url; FakeSocket.instances.push(this); }
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  emit(type: string, data?: unknown): void {
    for (const listener of this.listeners[type] || []) listener({ data });
  }
  open(): void { this.readyState = 1; this.emit("open"); }
  close(): void { this.readyState = 3; this.emit("close"); }
}

function clock() {
  let now = NOW;
  let nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    now: () => now,
    schedule: (callback: () => void, delay: number) => {
      const id = ++nextId;
      timers.set(id, { due: now + delay, callback });
      return () => { timers.delete(id); };
    },
    async advance(milliseconds: number) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].sort(([, a], [, b]) => a.due - b.due)[0];
        if (!next || next[1].due > end) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await settle();
      }
      now = end;
      await settle();
    },
    pending: () => timers.size,
  };
}

async function settle(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function rest(price: number, time = NOW): FetchResponseLike {
  return { ok: true, status: 200, json: async () => ({ price: String(price), time: new Date(time).toISOString() }) };
}

function ws(price: number, time = NOW, productId = spot.id): string {
  return JSON.stringify({ channel: "ticker", timestamp: new Date(time).toISOString(), events: [{
    tickers: [{ product_id: productId, price: String(price) }],
  }] });
}

function latestSocket(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  assert.ok(socket);
  return socket;
}

test("exact socket opens one frozen Coinbase product without the other mapped sources", () => {
  const product = { ...spot };
  const quotes: Quote[] = [];
  const before = FakeSocket.instances.length;
  const connection = createExactPriceSocket({
    product, marketSource: "coinbase", WebSocketImpl: FakeSocket,
    onQuotes: (values) => quotes.push(...values), now: () => NOW,
  });
  assert.equal(FakeSocket.instances.length, before);
  product.id = "ETH-USD";
  try {
    connection.start();
    connection.start();
    assert.equal(FakeSocket.instances.length, before + 1);
    const socket = latestSocket();
    assert.equal(socket.url, "wss://advanced-trade-ws.coinbase.com");
    socket.open();
    assert.deepEqual(socket.sent, [
      { type: "subscribe", product_ids: ["BTC-USD"], channel: "ticker" },
      { type: "subscribe", channel: "heartbeats" },
    ]);
    socket.emit("message", ws(101));
    socket.emit("message", ws(202, NOW, "ETH-USD"));
    assert.deepEqual(quotes.map((quote) => [quote.asset, quote.price]), [["BTC-USD", 101]]);
  } finally { connection.stop(); }
});

test("exact perpetual sockets retain a noncanonical Bybit mapping and the selected Gate mapping", () => {
  for (const marketSource of ["bybit", "gate"] as const) {
    const quotes: Quote[] = [];
    const before = FakeSocket.instances.length;
    const connection = createExactPriceSocket({
      product: perpetual, marketSource, WebSocketImpl: FakeSocket,
      onQuotes: (values) => quotes.push(...values), now: () => NOW,
    });
    try {
      connection.start();
      assert.equal(FakeSocket.instances.length, before + 1);
      const socket = latestSocket();
      socket.open();
      if (marketSource === "bybit") {
        assert.equal(socket.url, "wss://stream.bybit.com/v5/public/linear");
        assert.deepEqual(socket.sent, [{ op: "subscribe", args: ["tickers.AMDSTOCKUSDT"] }]);
        socket.emit("message", JSON.stringify({ topic: "tickers.AMDSTOCKUSDT", ts: NOW,
          data: { symbol: "AMDSTOCKUSDT", lastPrice: "125" } }));
      } else {
        assert.equal(socket.url, "wss://fx-ws.gateio.ws/v4/ws/usdt");
        assert.deepEqual((socket.sent[0] as { payload: string[] }).payload, ["AMD_USDT"]);
        socket.emit("message", JSON.stringify({ channel: "futures.tickers", event: "update", time_ms: NOW,
          result: [{ contract: "AMD_USDT", last: "125" }] }));
      }
      assert.equal(quotes[0]?.asset, perpetual.id);
      assert.equal(quotes[0]?.marketSource, marketSource);
      assert.equal(quotes[0]?.price, 125);
    } finally { connection.stop(); }
  }
});

test("exact socket rejects unsupported sources, wrong market classes and missing or guessed mappings", () => {
  const before = FakeSocket.instances.length;
  const invalid: Array<[Product, MarketSource | null]> = [
    [spot, null], [spot, "kraken"], [spot, "bybit"], [perpetual, "coinbase"],
    [{ ...spot, quoteCurrency: "USDT" }, "coinbase"],
    [{ ...spot, id: "BTC-USDT" }, "coinbase"],
    [{ ...perpetual, assetClass: "crypto" }, "bybit"],
    [{ ...perpetual, bybitSymbol: null }, "bybit"],
    [{ ...perpetual, bybitSymbol: "amdstockusdt" }, "bybit"],
    [{ ...perpetual, gateSymbol: "OTHER_USDT" }, "gate"],
  ];
  for (const [product, marketSource] of invalid) {
    assert.throws(() => createExactPriceSocket({
      product, marketSource, WebSocketImpl: FakeSocket, onQuotes: () => {},
    }), TypeError);
  }
  assert.equal(FakeSocket.instances.length, before);
});

test("chart quote starts explicitly and cold-starts one exact REST fallback", async () => {
  const time = clock();
  const requests: Array<[string, RequestInit]> = [];
  const changes: ChartCurrentPriceState[] = [];
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: async (url, init) => { requests.push([url, init]); return rest(102); },
    onChange: (state) => changes.push(state),
  });
  assert.equal(requests.length, 0);
  assert.equal(time.pending(), 0);
  try {
    price.start(); price.start();
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], "https://api.exchange.coinbase.com/products/BTC-USD/ticker");
    assert.equal(requests[0][1].cache, "no-store");
    assert.equal(price.state.quote?.price, 102);
    assert.equal(price.state.quote?.source, "coinbaseRest");
    assert.equal(price.state.stale, false);
    assert.equal(changes.length, 1);
  } finally { price.stop(); }
  assert.equal(time.pending(), 0);
  assert.deepEqual(price.state, { quote: null, stale: true });
});

test("fresh WS outranks a late REST response and prevents periodic fallback", async () => {
  const time = clock();
  const pending = deferred<FetchResponseLike>();
  let requests = 0;
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: () => { requests += 1; return pending.promise; }, onChange: () => {},
  });
  try {
    price.start();
    const socket = latestSocket(); socket.open();
    socket.emit("message", ws(110));
    pending.resolve(rest(99)); await settle();
    assert.equal(price.state.quote?.price, 110);
    assert.equal(price.state.quote?.transport, "ws");
    await time.advance(10_000);
    assert.equal(requests, 1);
    socket.emit("message", ws(111, time.now()));
    await time.advance(10_000);
    assert.equal(requests, 1);
    assert.equal(price.state.stale, false);
  } finally { price.stop(); }
});

test("WS expiry changes status without changing price and activates same-source fallback", async () => {
  const time = clock();
  let requests = 0;
  const changes: ChartCurrentPriceState[] = [];
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: async () => { requests += 1; return { ok: false, status: 503, json: async () => null }; },
    onChange: (state) => changes.push(state),
  });
  try {
    price.start(); latestSocket().open(); latestSocket().emit("message", ws(110));
    await settle();
    await time.advance(12_000);
    assert.equal(price.state.stale, false);
    assert.equal(requests, 1);
    await time.advance(1_000);
    assert.equal(price.state.stale, true);
    assert.equal(price.state.quote?.price, 110);
    assert.equal(requests, 2);
    assert.equal(changes.at(-1)?.stale, true);
    await time.advance(4_000); assert.equal(requests, 2);
    await time.advance(1_000); assert.equal(requests, 3);
  } finally { price.stop(); }
});

test("a quiet Coinbase REST last trade stays stale instead of adopting request time", async () => {
  const time = clock();
  const tradeTime = NOW - 60_000;
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: async () => rest(100, tradeTime), onChange: () => {},
  });
  try {
    price.start(); await settle();
    assert.equal(price.state.quote?.receivedAt, tradeTime);
    assert.equal(price.state.stale, true);
  } finally { price.stop(); }
});

test("perpetual REST requests and parsed symbols remain on the frozen selected source", async () => {
  for (const marketSource of ["bybit", "gate"] as const) {
    const time = clock();
    const product = { ...perpetual };
    const urls: string[] = [];
    let valid = false;
    const price = new ChartCurrentPrice({
      product, marketSource, WebSocketImpl: FakeSocket, ...time,
      fetchImpl: async (url) => {
        urls.push(url);
        const payload = marketSource === "bybit"
          ? { retCode: 0, time: time.now(), result: { list: [
            { symbol: valid ? "AMDSTOCKUSDT" : "AMDUSDT", lastPrice: "150" },
          ] } }
          : [{ contract: valid ? "AMD_USDT" : "OTHER_USDT", last: "150" }];
        return { ok: true, status: 200, json: async () => payload };
      },
      onChange: () => {},
    });
    product.bybitSymbol = "WRONGUSDT"; product.gateSymbol = "WRONG_USDT";
    try {
      price.start(); await settle();
      const invalidState = price.state;
      assert.equal(invalidState.quote, null);
      const expected = marketSource === "bybit"
        ? "https://api.bybit.com/v5/market/tickers?category=linear&symbol=AMDSTOCKUSDT"
        : "https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=AMD_USDT";
      assert.deepEqual(urls, [expected]);
      valid = true; await time.advance(5_000);
      assert.deepEqual(urls, [expected, expected]);
      assert.equal(price.state.quote?.marketSource, marketSource);
      assert.equal(price.state.quote?.price, 150);
    } finally { price.stop(); }
  }
});

test("rate limits pause only fallback for 60 seconds or 10 minutes while WS remains usable", async () => {
  for (const [status, cooldown] of [[429, 60_000], [403, 600_000]]) {
    const time = clock();
    let requests = 0;
    const price = new ChartCurrentPrice({
      product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
      fetchImpl: async () => { requests += 1; return { ok: false, status, json: async () => null }; },
      onChange: () => {},
    });
    try {
      price.start(); latestSocket().open(); await settle();
      latestSocket().emit("message", ws(123));
      assert.equal(price.state.quote?.price, 123);
      await time.advance(cooldown - 1_000);
      assert.equal(requests, 1);
      await time.advance(1_000);
      assert.equal(requests, 2);
    } finally { price.stop(); }
  }
});

test("fallback has one flight with an eight-second abort and ignores a late timed-out body", async () => {
  const time = clock();
  const pending = deferred<FetchResponseLike>();
  let requests = 0;
  let signal: AbortSignal | null = null;
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: (_url, init) => { requests += 1; signal = init.signal as AbortSignal; return pending.promise; },
    onChange: () => {},
  });
  try {
    price.start(); await time.advance(7_000);
    assert.equal(requests, 1);
    assert.equal((signal as AbortSignal | null)?.aborted, false);
    await time.advance(1_000);
    assert.equal((signal as AbortSignal | null)?.aborted, true);
    pending.resolve(rest(999)); await settle();
    assert.equal(price.state.quote, null);
  } finally { price.stop(); }
});

test("stop aborts work, clears timers and ignores previous-selection socket and JSON callbacks", async () => {
  const time = clock();
  const body = deferred<unknown>();
  let signal: AbortSignal | null = null;
  const changes: ChartCurrentPriceState[] = [];
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: async (_url, init) => {
      signal = init.signal as AbortSignal;
      return { ok: true, status: 200, json: () => body.promise };
    },
    onChange: (state) => changes.push(state),
  });
  price.start(); const socket = latestSocket(); socket.open(); await settle();
  socket.emit("message", ws(101)); assert.equal(changes.length, 1);
  price.stop(); assert.equal(changes.length, 2);
  assert.equal((signal as AbortSignal | null)?.aborted, true);
  assert.equal(socket.readyState, 3);
  assert.equal(time.pending(), 0);
  socket.emit("message", ws(999));
  body.resolve({ price: "999", time: new Date(NOW).toISOString() }); await settle();
  await time.advance(20_000);
  assert.equal(changes.length, 2);
  assert.deepEqual(price.state, { quote: null, stale: true });
});

test("restart cannot accept a response from the previous request generation", async () => {
  const time = clock();
  const old = deferred<FetchResponseLike>();
  let requests = 0;
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: () => ++requests === 1 ? old.promise : Promise.resolve(rest(222)),
    onChange: () => {},
  });
  try {
    price.start(); price.stop(); price.start(); await settle();
    assert.equal(price.state.quote?.price, 222);
    old.resolve(rest(111)); await settle();
    assert.equal(price.state.quote?.price, 222);
    assert.equal(time.pending(), 1);
  } finally { price.stop(); }
});

test("out-of-order WS prices and malformed REST values cannot replace valid same-source quotes", async () => {
  const time = clock();
  const price = new ChartCurrentPrice({
    product: spot, marketSource: "coinbase", WebSocketImpl: FakeSocket, ...time,
    fetchImpl: async () => ({ ok: true, json: async () => ({ price: "NaN" }) }),
    onChange: () => {},
  });
  try {
    price.start(); latestSocket().open();
    latestSocket().emit("message", ws(123));
    latestSocket().emit("message", ws(100, NOW - 1_000));
    await settle();
    assert.equal(price.state.quote?.price, 123);
    await time.advance(13_000);
    assert.equal(price.state.quote?.price, 123);
    assert.equal(price.state.stale, true);
  } finally { price.stop(); }
});
