import test from "node:test";
import assert from "node:assert/strict";

import { ChartLiveCandles } from "../src/chart-live-candles.ts";
import { CandleHistoryError } from "../src/candle-history.ts";
import type { Candle, CandleHistoryPage, CandleInterval } from "../src/candle-history.ts";
import type { ChartCurrentPriceState } from "../src/chart-current-price.ts";

const NOW = Date.UTC(2026, 8, 9, 12) + 10_000;
const MINUTE = 60_000;
const bucket = (time: number, duration = MINUTE): number => Math.floor(time / duration) * duration;
const candle = (openTime = bucket(NOW), close = 105): Candle => ({
  openTime, open: 100, high: Math.max(110, close), low: Math.min(90, close), close,
});
const page = (candles: Candle[]): CandleHistoryPage => ({ candles, nextBefore: candles[0]?.openTime ?? 0 });
const quote = (price = 105, exchangeAt = NOW, stale = false): ChartCurrentPriceState => ({
  quote: {
    asset: "BTC-USD", marketSource: "coinbase", source: "coinbase", sourceLabel: "Coinbase",
    price, exchangeAt, receivedAt: exchangeAt,
  }, stale,
});

async function settle(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function clock() {
  let now = NOW;
  let nextId = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    now: () => now,
    jump: (time: number) => { now = time; },
    schedule: (callback: () => void, delay: number) => {
      const id = ++nextId;
      timers.set(id, { due: now + delay, callback });
      return () => { timers.delete(id); };
    },
    async advance(milliseconds: number) {
      const end = now + milliseconds;
      while (true) {
        const next = [...timers].sort(([, left], [, right]) => left.due - right.due)[0];
        if (!next || next[1].due > end) break;
        now = Math.max(now, next[1].due);
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

function fixture(interval: CandleInterval = "1m", initial: Candle[] = [candle()]) {
  const time = clock();
  let candles = initial;
  let changes = 0;
  const requests: Array<ReturnType<typeof deferred<CandleHistoryPage>> & {
    signal: AbortSignal; startedAt: number;
  }> = [];
  const live = new ChartLiveCandles({
    interval, productId: "BTC-USD", marketSource: "coinbase", snapshotStartedAt: NOW,
    getCandles: () => candles,
    mergeCandles: (recent) => {
      const merged = new Map(candles.map((item) => [item.openTime, item]));
      for (const item of recent) merged.set(item.openTime, { ...item });
      candles = [...merged.values()].sort((left, right) => left.openTime - right.openTime);
    },
    loadRecent: (signal) => {
      const pending = { ...deferred<CandleHistoryPage>(), signal, startedAt: time.now() };
      requests.push(pending);
      return pending.promise;
    },
    onChange: () => { changes += 1; }, now: time.now, schedule: time.schedule,
  });
  live.start();
  return { live, time, requests, candles: () => candles, changes: () => changes };
}

test("same-bucket live quotes keep open and synchronize close, extrema and guide", () => {
  const f = fixture();
  try {
    assert.deepEqual(f.live.state, { price: null, stale: true, syncing: false });
    f.live.setQuote(quote(120));
    assert.deepEqual(f.candles()[0], { openTime: bucket(NOW), open: 100, high: 120, low: 90, close: 120 });
    f.live.setQuote(quote(80, NOW + 1));
    f.live.setQuote(quote(107, NOW + 2));
    assert.deepEqual(f.candles()[0], { openTime: bucket(NOW), open: 100, high: 120, low: 80, close: 107 });
    assert.deepEqual(f.live.state, { price: 107, stale: false, syncing: false });
    assert.equal(f.requests.length, 0);
  } finally { f.live.stop(); }
});

test("initial snapshots are not fetched again before a boundary or reconciliation interval", async () => {
  const f = fixture();
  try {
    f.live.start();
    f.live.setQuote(quote());
    await f.time.advance(29_999);
    assert.equal(f.requests.length, 0);
    await f.time.advance(1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.live.state.syncing, true);
    f.requests[0]!.resolve(page([candle(bucket(NOW), 106)]));
    await settle();
    assert.equal(f.live.state.price, 106);
    assert.equal(f.live.state.syncing, false);
  } finally { f.live.stop(); }
});

test("all supported intervals roll over only when a real new candle arrives", async () => {
  const durations: Array<[CandleInterval, number]> = [
    ["1m", 60_000], ["5m", 300_000], ["15m", 900_000], ["1h", 3_600_000], ["1d", 86_400_000],
  ];
  for (const [interval, duration] of durations) {
    const initial = candle(bucket(NOW, duration));
    const f = fixture(interval, [initial]);
    try {
      f.live.setQuote(quote(107));
      const nextBucket = initial.openTime + duration;
      f.time.jump(nextBucket + 1);
      f.live.setQuote(quote(115, f.time.now()));
      assert.equal(f.requests.length, 1, interval);
      assert.equal(f.candles().length, 1, interval);
      assert.equal(f.live.state.price, 107, interval);
      assert.equal(f.live.state.syncing, true, interval);
      f.requests[0]!.resolve(page([candle(initial.openTime, 109), candle(nextBucket, 114)]));
      await settle();
      assert.equal(f.candles().length, 2, interval);
      assert.equal(f.live.state.price, 115, interval);
      assert.equal(f.live.state.syncing, false, interval);
      f.live.setQuote(quote(117, f.time.now() + 1));
      assert.equal(f.candles().at(-1)!.close, 117, interval);
      assert.equal(f.live.state.price, 117, interval);
    } finally { f.live.stop(); }
  }
});

test("the clock refreshes the real tail at a bucket boundary without ticker activity", async () => {
  const f = fixture();
  try {
    await f.time.advance(30_000);
    f.requests[0]!.resolve(page([candle()]));
    await settle();
    await f.time.advance(20_000);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[1]!.startedAt, bucket(NOW) + MINUTE);
    assert.equal(f.candles().length, 1);
    assert.equal(f.live.state.price, null);
  } finally { f.live.stop(); }
});

test("empty or lagging tail results never fabricate a candle and retry at five-second spacing", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote());
    f.time.jump(bucket(NOW) + MINUTE);
    f.live.setQuote(quote(120, f.time.now()));
    f.requests[0]!.resolve(page([]));
    await settle();
    await f.time.advance(4_999);
    assert.equal(f.requests.length, 1);
    await f.time.advance(1);
    assert.equal(f.requests.length, 2);
    f.requests[1]!.resolve(page([candle()]));
    await settle();
    assert.equal(f.live.state.syncing, true);
    assert.equal(f.live.state.price, 105);
    assert.equal(f.candles().length, 1);
    await f.time.advance(5_000);
    assert.equal(f.requests.length, 3);
    assert.equal(f.requests[2]!.startedAt - f.requests[1]!.startedAt, 5_000);
  } finally { f.live.stop(); }
});

test("delayed REST replays every accepted in-flight extreme and the latest close", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote());
    await f.time.advance(30_000);
    await f.time.advance(1_000);
    f.live.setQuote(quote(125, f.time.now()));
    await f.time.advance(1_000);
    f.live.setQuote(quote(75, f.time.now()));
    await f.time.advance(1_000);
    f.live.setQuote(quote(112, f.time.now()));
    f.requests[0]!.resolve(page([candle(bucket(NOW), 108)]));
    await settle();
    assert.deepEqual(f.candles()[0], { openTime: bucket(NOW), open: 100, high: 125, low: 75, close: 112 });
    assert.equal(f.live.state.price, 112);
    f.live.setQuote(quote(50, NOW + 31_000));
    assert.equal(f.candles()[0]!.close, 112);
    assert.equal(f.candles()[0]!.low, 75);
  } finally { f.live.stop(); }
});

test("rollover in-flight quotes replay only into provider-returned buckets", async () => {
  const f = fixture();
  try {
    const next = bucket(NOW) + MINUTE;
    f.time.jump(next);
    f.live.setQuote(quote(110, next));
    f.live.setQuote(quote(125, next + 1));
    f.live.setQuote(quote(75, next + 2));
    f.live.setQuote(quote(112, next + 3));
    assert.equal(f.candles().length, 1);
    f.requests[0]!.resolve(page([candle(next, 111)]));
    await settle();
    assert.deepEqual(f.candles().at(-1), { openTime: next, open: 100, high: 125, low: 75, close: 112 });
    assert.equal(f.live.state.price, 112);
  } finally { f.live.stop(); }
});

test("the rollover-triggering tick survives a delayed snapshot even without a following tick", async () => {
  const f = fixture();
  try {
    const next = bucket(NOW) + MINUTE;
    f.time.jump(next);
    f.live.setQuote(quote(150, next));
    assert.equal(f.candles().length, 1);
    assert.equal(f.requests.length, 1);
    f.requests[0]!.resolve(page([candle(next, 111)]));
    await settle();
    assert.deepEqual(f.candles().at(-1), { openTime: next, open: 100, high: 150, low: 90, close: 150 });
    assert.equal(f.live.state.price, 150);
  } finally { f.live.stop(); }
});

test("triggering extrema survive subsequent ticks and delayed rollover history", async () => {
  for (const trigger of [150, 50]) {
    const f = fixture();
    try {
      const next = bucket(NOW) + MINUTE;
      f.time.jump(next);
      f.live.setQuote(quote(trigger, next));
      f.live.setQuote(quote(112, next + 1));
      f.requests[0]!.resolve(page([candle(next, 109)]));
      await settle();
      assert.deepEqual(f.candles().at(-1), {
        openTime: next, open: 100, high: Math.max(112, trigger), low: Math.min(90, trigger), close: 112,
      });
      assert.equal(f.live.state.price, 112);
    } finally { f.live.stop(); }
  }
});

test("the stale-recovery trigger retains its close and extreme through the refresh it starts", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote(105, NOW, true));
    f.time.jump(NOW + 1);
    f.live.setQuote(quote(150, f.time.now()));
    assert.equal(f.requests.length, 1);
    f.requests[0]!.resolve(page([candle(bucket(NOW), 111)]));
    await settle();
    assert.equal(f.live.state.price, 150);
    assert.equal(f.candles().at(-1)!.high, 150);
    assert.equal(f.live.state.stale, false);
  } finally { f.live.stop(); }
});

test("pre-snapshot quotes cannot overwrite a newer history snapshot, including during refresh", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote(130, NOW - 1));
    assert.equal(f.live.state.price, 105);
    await f.time.advance(30_000);
    // Delivered during fetch, but its event predates the REST request start.
    f.live.setQuote(quote(140, NOW + 29_000));
    assert.equal(f.live.state.price, 140);
    f.requests[0]!.resolve(page([candle(bucket(NOW), 108)]));
    await settle();
    assert.equal(f.live.state.price, 108);
    f.live.setQuote(quote(150, NOW + 29_001));
    assert.equal(f.live.state.price, 108);
  } finally { f.live.stop(); }
});

test("stale quotes keep candle-aligned stale values and recovery requests the actual tail", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote(107));
    f.live.setQuote(quote(130, NOW + 1, true));
    assert.deepEqual(f.live.state, { price: 107, stale: true, syncing: false });
    assert.equal(f.candles()[0]!.close, 107);
    f.live.setQuote(quote(108, NOW + 2));
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.live.state, { price: 108, stale: false, syncing: true });
    f.live.setQuote(quote(160, NOW + 3, true));
    f.requests[0]!.resolve(page([candle(bucket(NOW), 109)]));
    await settle();
    assert.equal(f.live.state.price, 108);
    assert.equal(f.live.state.stale, true);
    assert.equal(f.candles()[0]!.high, 110);
  } finally { f.live.stop(); }
});

test("missing/foreign/malformed quotes do not create a guide or mutate OHLC", () => {
  const f = fixture();
  try {
    const invalid = [
      { ...quote().quote!, asset: "ETH-USD" },
      { ...quote().quote!, marketSource: "bybit" as const },
      { ...quote().quote!, price: NaN },
      { ...quote().quote!, price: 0 },
      { ...quote().quote!, exchangeAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...quote().quote!, receivedAt: 0 },
    ];
    for (const item of invalid) f.live.setQuote({ quote: item, stale: false });
    assert.equal(f.live.state.price, null);
    assert.deepEqual(f.candles(), [candle()]);
    f.live.setQuote(quote(107));
    f.live.setQuote({ quote: null, stale: true });
    assert.equal(f.live.state.price, null);
    assert.equal(f.candles()[0]!.close, 107);
  } finally { f.live.stop(); }
});

test("empty history requests a real first candle on a fresh tick without synthesizing OHLC", async () => {
  const f = fixture("1m", []);
  try {
    f.live.setQuote(quote(120));
    assert.deepEqual(f.candles(), []);
    assert.equal(f.live.state.price, null);
    assert.equal(f.requests.length, 1);
    f.requests[0]!.resolve(page([candle(bucket(NOW), 119)]));
    await settle();
    assert.deepEqual(f.candles(), [candle(bucket(NOW), 120)]);
    assert.equal(f.live.state.price, 120);
  } finally { f.live.stop(); }
});

test("one tail request runs at a time; timeout aborts and ignores a late result", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote());
    await f.time.advance(30_000);
    await f.time.advance(7_999);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0]!.signal.aborted, false);
    await f.time.advance(1);
    assert.equal(f.requests[0]!.signal.aborted, true);
    assert.equal(f.requests.length, 2);
    f.requests[0]!.resolve(page([candle(bucket(NOW), 999)]));
    await settle();
    assert.equal(f.live.state.price, 105);
    f.requests[1]!.resolve(page([candle(bucket(NOW), 108)]));
    await settle();
    assert.equal(f.live.state.price, 108);
  } finally { f.live.stop(); }
});

test("429 and 403 tail limits apply their full cooldown without blocking same-bucket ticks", async () => {
  for (const [status, cooldown] of [[429, 60_000], [403, 600_000]] as const) {
    const f = fixture("1d", [candle(bucket(NOW, 86_400_000))]);
    try {
      f.live.setQuote(quote());
      await f.time.advance(30_000);
      f.requests[0]!.reject(new CandleHistoryError("http", "limited", status));
      await settle();
      f.live.setQuote(quote(115, f.time.now() + 1));
      assert.equal(f.live.state.price, 115);
      await f.time.advance(cooldown - 1);
      assert.equal(f.requests.length, 1, String(status));
      await f.time.advance(1);
      assert.equal(f.requests.length, 2, String(status));
    } finally { f.live.stop(); }
  }
});

test("network failures keep the existing candle and guide until paced recovery", async () => {
  const f = fixture();
  try {
    f.live.setQuote(quote(108));
    await f.time.advance(30_000);
    f.requests[0]!.reject(new Error("offline"));
    await settle();
    assert.deepEqual(f.live.state, { price: 108, stale: false, syncing: true });
    await f.time.advance(5_000);
    assert.equal(f.requests.length, 2);
    f.requests[1]!.resolve(page([candle(bucket(NOW), 109)]));
    await settle();
    assert.deepEqual(f.live.state, { price: 109, stale: false, syncing: false });
  } finally { f.live.stop(); }
});

test("stop aborts requests, clears timers and rejects quotes and previous-generation responses", async () => {
  const f = fixture();
  f.live.setQuote(quote(108));
  await f.time.advance(30_000);
  f.live.stop();
  assert.equal(f.requests[0]!.signal.aborted, true);
  assert.equal(f.time.pending(), 0);
  assert.deepEqual(f.live.state, { price: null, stale: true, syncing: false });
  const changes = f.changes();
  f.live.setQuote(quote(200, f.time.now()));
  f.requests[0]!.resolve(page([candle(bucket(NOW), 999)]));
  await settle();
  assert.equal(f.changes(), changes);
  assert.equal(f.candles()[0]!.close, 108);
  f.live.start();
  await f.time.advance(5_000);
  assert.equal(f.requests.length, 2);
  f.live.setQuote(quote(111, f.time.now()));
  f.requests[1]!.resolve(page([candle(bucket(NOW), 109)]));
  await settle();
  assert.equal(f.live.state.price, 111);
  f.live.stop();
  assert.equal(f.time.pending(), 0);
});
