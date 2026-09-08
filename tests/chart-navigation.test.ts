import test from "node:test";
import assert from "node:assert/strict";

import type { Candle, CandleHistoryPage } from "../src/candle-history.ts";
import { CandleHistoryError } from "../src/candle-history.ts";
import { ChartNavigation, MAX_HISTORY_CANDLES } from "../src/chart-navigation.ts";

function candle(openTime: number): Candle {
  return { openTime, open: 100, high: 102, low: 99, close: 101 };
}

function page(start: number, count = 240): CandleHistoryPage {
  return { candles: Array.from({ length: count }, (_, index) => candle(start + index)), nextBefore: start };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fakeClock(): {
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
  advance: (milliseconds: number) => Promise<void>;
  pending: () => number;
} {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  return {
    now: () => now,
    schedule: (callback, delay) => {
      const timerId = ++id;
      timers.set(timerId, { due: now + delay, callback });
      return () => { timers.delete(timerId); };
    },
    advance: async (milliseconds) => {
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

test("initial zoom-out reveals more loaded history and keeps the latest edge", () => {
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return page(9_760); },
    onChange: () => {},
  });
  assert.deepEqual(navigation.viewport, { start: 120, count: 120 });
  navigation.zoom(0.8);
  assert.deepEqual(navigation.viewport, { start: 90, count: 150 });
  navigation.zoom(0.8);
  assert.deepEqual(navigation.viewport, { start: 52.5, count: 187.5 });
  assert.equal(requests, 0);
  navigation.zoom(2);
  assert.deepEqual(navigation.viewport, { start: 146.25, count: 93.75 });
});

test("zooming beyond loaded candles prepends history and preserves a pointer anchor", async () => {
  const pending = deferred<CandleHistoryPage>();
  const changes: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => { assert.equal(before, 10_000); return pending.promise; },
    onChange: (added) => changes.push(added),
  });
  navigation.setViewport({ start: 10, count: 120 });
  const anchorTime = navigation.candles[0].openTime + navigation.viewport.start + navigation.viewport.count * 0.25;
  navigation.zoom(0.5, 0.25);
  assert.equal(navigation.loadingOlder, true);
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 220, count: 240 });
  assert.equal(navigation.candles[0].openTime + navigation.viewport.start + navigation.viewport.count * 0.25, anchorTime);
  assert.equal(changes.filter((added) => added > 0).length, 1);
  assert.equal(changes.includes(240), true);
  assert.equal(navigation.loadingOlder, false);
});

test("successive zoom-out intents share one request and reveal more than 240 candles", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.zoom(0.4);
  navigation.zoom(0.75);
  assert.equal(requests, 1);
  assert.equal(navigation.viewport.count, 240);
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 80, count: 400 });
  assert.equal(requests, 1);
  assert.equal(navigation.candles.at(-1)?.openTime, 10_239);
});

for (const action of ["reset", "zoom-in", "pan-newer"] as const) {
  test(`${action} during an older request wins over the previous viewport intent`, async () => {
    const pending = deferred<CandleHistoryPage>();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      loadPage: async () => { requests += 1; return pending.promise; },
      onChange: () => {},
    });
    navigation.zoom(0.25);
    if (action === "reset") navigation.reset();
    else if (action === "zoom-in") navigation.zoom(2);
    else {
      navigation.setViewport({ start: -100, count: 120 });
      navigation.pan(220);
    }
    pending.resolve(page(9_760));
    await settle();
    assert.deepEqual(navigation.viewport, { start: 360, count: 120 });
    assert.equal(requests, 1);
    assert.equal(navigation.needsOlder, false);
  });
}

test("a small zoom-in immediately enlarges the rendered candles and abandons a large pending range", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.zoom(0.01);
  assert.equal(navigation.viewport.count, 240);
  navigation.zoom(1.25);
  assert.deepEqual(navigation.viewport, { start: 48, count: 192 });
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 288, count: 192 });
  assert.equal(requests, 1);
  assert.equal(navigation.needsOlder, false);
});

test("End abandons a pending older range and keeps the rendered scale at the latest edge", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.zoom(0.01);
  navigation.pan(Number.POSITIVE_INFINITY);
  assert.deepEqual(navigation.viewport, { start: 0, count: 240 });
  assert.equal(navigation.needsOlder, false);
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 240, count: 240 });
  assert.equal(requests, 1);
});

test("an initially empty scan can continue into earlier history and show the newest 120 available candles", async () => {
  const beforeValues: number[] = [];
  const navigation = new ChartNavigation({ candles: [], nextBefore: 10_000 }, {
    loadPage: async (before) => { beforeValues.push(before); return page(9_760); },
    onChange: () => {},
  });
  assert.deepEqual(navigation.viewport, { start: 0, count: 0 });
  assert.equal(navigation.canLoadOlder, true);
  assert.deepEqual(beforeValues, []);
  navigation.continueLoading();
  await settle();
  assert.deepEqual(beforeValues, [10_000]);
  assert.deepEqual(navigation.viewport, { start: 120, count: 120 });
  assert.equal(navigation.needsOlder, false);
});

test("cancel aborts and ignores a late response without notifications", async () => {
  const pending = deferred<CandleHistoryPage>();
  let signal: AbortSignal | undefined;
  let changes = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (_before, requestSignal) => { signal = requestSignal; return pending.promise; },
    onChange: () => { changes += 1; },
  });
  navigation.zoom(0.25);
  navigation.cancel();
  const changesBeforeResponse = changes;
  assert.equal(signal?.aborted, true);
  pending.resolve(page(9_760));
  await settle();
  assert.equal(changes, changesBeforeResponse);
  assert.equal(navigation.candles.length, 240);
  assert.equal(navigation.loadingOlder, false);
  assert.equal(navigation.canLoadOlder, false);
});

test("a failed older page preserves the chart and retries only on user action", async () => {
  const beforeValues: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => {
      beforeValues.push(before);
      if (beforeValues.length === 1) throw new Error("network failure");
      return page(9_760);
    },
    onChange: () => {},
  });
  navigation.zoom(0.25);
  await settle();
  assert.deepEqual(beforeValues, [10_000]);
  assert.equal(navigation.candles.length, 240);
  assert.equal(navigation.viewport.count, 240);
  assert.match(navigation.historyMessage, /失败.*保留.*重试/);
  assert.equal(navigation.needsOlder, true);
  navigation.continueLoading();
  await settle();
  assert.deepEqual(beforeValues, [10_000, 10_000]);
  assert.equal(navigation.viewport.count, 480);
  assert.equal(navigation.historyMessage, "");
});

test("a failed request for an abandoned range does not overwrite reset status", async () => {
  const pending = deferred<CandleHistoryPage>();
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => pending.promise,
    onChange: () => {},
  });
  navigation.zoom(0.25);
  navigation.reset();
  pending.reject(new Error("obsolete network failure"));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 120, count: 120 });
  assert.equal(navigation.historyMessage, "");
  assert.equal(navigation.loadingOlder, false);
  assert.equal(navigation.needsOlder, false);
});

test("empty and sparse pages advance their scan cursor, with at most four pages per batch", async () => {
  const beforeValues: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => {
      beforeValues.push(before);
      return { candles: beforeValues.length === 5 ? [candle(before - 1)] : [], nextBefore: before - 240 };
    },
    onChange: () => {},
  });
  navigation.pan(-121);
  await settle();
  assert.deepEqual(beforeValues, [10_000, 9_760, 9_520, 9_280]);
  assert.equal(navigation.candles.length, 240);
  assert.equal(navigation.needsOlder, true);
  assert.equal(navigation.canLoadOlder, true);
  assert.match(navigation.historyMessage, /继续加载/);
  navigation.continueLoading();
  await settle();
  assert.deepEqual(beforeValues, [10_000, 9_760, 9_520, 9_280, 9_040]);
  assert.equal(navigation.candles.length, 241);
  assert.deepEqual(navigation.viewport, { start: 0, count: 120 });
  assert.equal(navigation.needsOlder, false);
});

test("prepending sorts and deduplicates older candles without replacing loaded data", async () => {
  const changes: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => ({
      candles: [candle(9_999), candle(9_998), candle(9_999), { ...candle(10_000), close: 999 }],
      nextBefore: 9_760,
    }),
    onChange: (added) => changes.push(added),
  });
  navigation.pan(-122);
  await settle();
  assert.equal(navigation.candles.length, 242);
  assert.deepEqual(navigation.candles.slice(0, 3).map(({ openTime }) => openTime), [9_998, 9_999, 10_000]);
  assert.equal(navigation.candles[2].close, 101);
  assert.equal(changes.includes(2), true);
  assert.equal(navigation.needsOlder, false);
});

test("history cache stops at its explicit limit and keeps the nearest older candles", async () => {
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000, MAX_HISTORY_CANDLES - 10), {
    loadPage: async () => { requests += 1; return page(9_760); },
    onChange: () => {},
  });
  navigation.setViewport({ start: -100, count: 120 });
  await settle();
  assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
  assert.equal(navigation.candles[0].openTime, 9_990);
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.needsOlder, false);
  assert.match(navigation.historyMessage, /4800.*上限/);
  navigation.pan(-1_000);
  navigation.continueLoading();
  await settle();
  assert.equal(requests, 1);
  assert.deepEqual(navigation.viewport, { start: 0, count: 120 });
});

test("a zero cursor honestly stops at the queryable history boundary", async () => {
  const navigation = new ChartNavigation(page(240), {
    loadPage: async () => page(0),
    onChange: () => {},
  });
  navigation.zoom(0.1);
  await settle();
  assert.equal(navigation.candles.length, 480);
  assert.deepEqual(navigation.viewport, { start: 0, count: 480 });
  assert.equal(navigation.canLoadOlder, false);
  assert.match(navigation.historyMessage, /时间边界/);
});

test("a nonadvancing cursor cannot spin or silently declare history exhausted", async () => {
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => { requests += 1; return { candles: [], nextBefore: before }; },
    onChange: () => {},
  });
  navigation.zoom(0.25);
  await settle();
  assert.equal(requests, 1);
  assert.equal(navigation.canLoadOlder, true);
  assert.equal(navigation.needsOlder, true);
  assert.match(navigation.historyMessage, /未返回更早.*重试/);
});

test("prefetch warms a bounded left buffer at one page per second without moving the visible candles", async () => {
  const clock = fakeClock();
  const requests: number[] = [];
  const changes: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => { requests.push(before); return page(before - 240); },
    onChange: (added) => changes.push(added),
  });
  const visibleTime = navigation.candles[navigation.viewport.start].openTime;
  navigation.startPrefetch();
  navigation.startPrefetch();
  assert.equal(clock.pending(), 1);
  await clock.advance(999);
  assert.deepEqual(requests, []);
  await clock.advance(1);
  assert.deepEqual(requests, [10_000]);
  assert.deepEqual(navigation.viewport, { start: 360, count: 120 });
  assert.equal(navigation.historyMessage, "");
  await clock.advance(1_000);
  assert.deepEqual(requests, [10_000, 9_760]);
  assert.equal(navigation.candles.length, 720);
  assert.deepEqual(navigation.viewport, { start: 600, count: 120 });
  assert.equal(navigation.candles[navigation.viewport.start].openTime, visibleTime);
  assert.deepEqual(changes.filter((added) => added > 0), [240, 240]);
  assert.equal(clock.pending(), 0);
  await clock.advance(100_000);
  assert.equal(requests.length, 2);
});

test("approaching the buffered left edge schedules more history before any candle is missing", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000, 720), {
    ...clock,
    loadPage: async (before) => { requests += 1; return page(before - 240); },
    onChange: () => {},
  });
  navigation.startPrefetch();
  assert.equal(clock.pending(), 0);
  navigation.pan(-150);
  assert.equal(navigation.needsOlder, false);
  assert.deepEqual(navigation.viewport, { start: 450, count: 120 });
  assert.equal(requests, 0);
  const firstVisible = navigation.candles[450].openTime;
  await clock.advance(1_000);
  assert.equal(requests, 1);
  assert.deepEqual(navigation.viewport, { start: 690, count: 120 });
  assert.equal(navigation.candles[690].openTime, firstVisible);
  assert.equal(clock.pending(), 0);
});

test("foreground demand bypasses a queued prefetch delay and cancels that timer", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => { requests += 1; return page(before - 240); },
    onChange: () => {},
  });
  navigation.startPrefetch();
  navigation.zoom(0.25);
  assert.equal(requests, 1);
  assert.equal(clock.pending(), 0);
  await settle();
  assert.equal(navigation.viewport.count, 480);
  assert.equal(clock.pending(), 1);
  navigation.cancel();
  await clock.advance(10_000);
  assert.equal(requests, 1);
});

test("demand arriving during prefetch reuses its request and continues a bounded foreground batch", async () => {
  const clock = fakeClock();
  const pending = deferred<CandleHistoryPage>();
  const requests: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => {
      requests.push(before);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try { return requests.length === 1 ? await pending.promise : page(before - 240); }
      finally { inFlight -= 1; }
    },
    onChange: () => {},
  });
  navigation.startPrefetch();
  await clock.advance(1_000);
  navigation.zoom(0.01);
  assert.equal(requests.length, 1);
  assert.match(navigation.historyMessage, /正在加载/);
  pending.resolve(page(9_760));
  await settle();
  assert.equal(peakInFlight, 1);
  assert.deepEqual(requests, [10_000, 9_760, 9_520, 9_280]);
  assert.equal(navigation.candles.length, 1_200);
  assert.equal(navigation.needsOlder, true);
  assert.match(navigation.historyMessage, /继续加载/);
  assert.equal(clock.pending(), 0);
});

for (const action of ["reset", "zoom-in", "End"] as const) {
  test(`an in-flight prefetch preserves ${action} and its visible scale`, async () => {
    const clock = fakeClock();
    const pending = deferred<CandleHistoryPage>();
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async () => pending.promise,
      onChange: () => {},
    });
    navigation.startPrefetch();
    await clock.advance(1_000);
    navigation.zoom(0.01);
    if (action === "reset") navigation.reset();
    else if (action === "zoom-in") navigation.zoom(2);
    else navigation.pan(Number.POSITIVE_INFINITY);
    const current = navigation.viewport;
    const visibleStart = navigation.candles[0].openTime + current.start;
    pending.resolve(page(9_760));
    await settle();
    assert.equal(navigation.viewport.count, current.count);
    assert.equal(navigation.candles[0].openTime + navigation.viewport.start, visibleStart);
    assert.equal(navigation.needsOlder, false);
    navigation.cancel();
  });
}

test("prefetch waits after completion, and cancellation aborts its request and discards a late page", async () => {
  const clock = fakeClock();
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  let signal: AbortSignal | undefined;
  let changes = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (_before, requestSignal) => {
      requests += 1;
      signal = requestSignal;
      return pending.promise;
    },
    onChange: () => { changes += 1; },
  });
  navigation.startPrefetch();
  await clock.advance(10_000);
  assert.equal(requests, 1);
  assert.equal(clock.pending(), 0);
  navigation.cancel();
  const finalChanges = changes;
  assert.equal(signal?.aborted, true);
  pending.resolve(page(9_760));
  await settle();
  await clock.advance(10_000);
  assert.equal(requests, 1);
  assert.equal(changes, finalChanges);
  assert.equal(navigation.candles.length, 240);
});

for (const failure of ["empty", "nonadvancing", "network"] as const) {
  test(`${failure} prefetch pauses silently until a successful explicit demand fetch`, async () => {
    const clock = fakeClock();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        requests += 1;
        if (requests === 1) {
          if (failure === "network") throw new Error("offline");
          return { candles: [], nextBefore: failure === "empty" ? before - 240 : before };
        }
        return page(before - 240);
      },
      onChange: () => {},
    });
    navigation.startPrefetch();
    await clock.advance(100_000);
    assert.equal(requests, 1);
    assert.equal(navigation.historyMessage, "");
    navigation.pan(-20);
    navigation.reset();
    navigation.startPrefetch();
    await clock.advance(100_000);
    assert.equal(requests, 1);
    navigation.zoom(0.25);
    await settle();
    assert.equal(requests, 2);
    assert.equal(navigation.viewport.count, 480);
    assert.equal(clock.pending(), 1);
    navigation.cancel();
  });
}

test("sparse prefetch performs no more than four paced pages per refill", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => {
      requests += 1;
      return { candles: [candle(before - 1)], nextBefore: before - 240 };
    },
    onChange: () => {},
  });
  navigation.startPrefetch();
  await clock.advance(100_000);
  assert.equal(requests, 4);
  assert.equal(navigation.candles.length, 244);
  assert.deepEqual(navigation.viewport, { start: 124, count: 120 });
  assert.equal(navigation.needsOlder, false);
  assert.equal(navigation.historyMessage, "");
  navigation.pan(-5);
  await clock.advance(100_000);
  assert.equal(requests, 4);
});

for (const status of [429, 403]) {
  test(`HTTP ${status} pauses speculative work and repeated manual retries until the cooldown expires`, async () => {
    const clock = fakeClock();
    const cooldown = status === 403 ? 600_000 : 60_000;
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        requests += 1;
        if (requests === 1) throw new CandleHistoryError("http", "rate limited", status);
        return page(before - 240);
      },
      onChange: () => {},
    });
    navigation.startPrefetch();
    await clock.advance(1_000);
    navigation.zoom(0.25);
    navigation.continueLoading();
    navigation.pan(-1);
    assert.equal(requests, 1);
    assert.match(navigation.historyMessage, /请求受限.*稍后重试/);
    assert.equal(clock.pending(), 0);
    await clock.advance(cooldown - 1);
    navigation.continueLoading();
    assert.equal(requests, 1);
    await clock.advance(1);
    assert.equal(requests, 1);
    navigation.reset();
    navigation.zoom(0.25);
    await settle();
    assert.equal(requests, 2);
    assert.equal(navigation.viewport.count, 480);
    assert.equal(clock.pending(), 1);
    navigation.cancel();
  });
}

test("prefetch never starts on an empty initial range, a full cache, or a historical boundary", async () => {
  const clock = fakeClock();
  let requests = 0;
  for (const initial of [{ candles: [], nextBefore: 10_000 }, page(10_000, MAX_HISTORY_CANDLES), page(0)]) {
    const navigation = new ChartNavigation(initial, {
      ...clock,
      loadPage: async () => { requests += 1; return page(0); },
      onChange: () => {},
    });
    navigation.startPrefetch();
    await clock.advance(10_000);
    assert.equal(clock.pending(), 0);
    navigation.cancel();
  }
  assert.equal(requests, 0);
});
