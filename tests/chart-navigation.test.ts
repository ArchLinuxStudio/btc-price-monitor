import test from "node:test";
import assert from "node:assert/strict";

import type { Candle, CandleHistoryPage } from "../src/candle-history.ts";
import { CandleHistoryError } from "../src/candle-history.ts";
import { ChartNavigation, MAX_HISTORY_CANDLES } from "../src/chart-navigation.ts";
import { candleBarGeometry, candleViewportBounds } from "../src/chart-viewport.ts";

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

test("recent candles replace known buckets and append sorted real buckets without backfilling history", () => {
  const initial = [candle(10), candle(20)];
  const changes: number[] = [];
  const navigation = new ChartNavigation({ candles: initial, nextBefore: 10 }, {
    loadPage: async () => page(0), onChange: (shift) => changes.push(shift),
  });
  const updated = { ...candle(20), high: 106, close: 105 };
  const appended = { ...candle(25), low: 98, close: 100 };
  navigation.mergeRecentCandles([candle(5), candle(15), candle(25), updated, appended]);
  assert.deepEqual(navigation.candles.map((entry) => entry.openTime), [10, 20, 25]);
  assert.deepEqual(navigation.candles[1], updated);
  assert.deepEqual(navigation.candles[2], appended);
  assert.notEqual(navigation.candles[1], updated);
  assert.notEqual(navigation.candles[2], appended);
  assert.deepEqual(initial, [candle(10), candle(20)]);
  assert.deepEqual(changes, [0]);
  const previous = navigation.candles;
  navigation.mergeRecentCandles([updated, appended]);
  assert.equal(navigation.candles, previous);
  assert.deepEqual(changes, [0]);
});

test("new real buckets follow an aligned latest viewport without changing its scale", () => {
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => page(9_760), onChange: () => {},
  });
  navigation.mergeRecentCandles([candle(10_240), candle(10_243)]);
  assert.deepEqual(navigation.viewport, { start: 122, count: 120 });
  assert.deepEqual(navigation.candles.slice(-3).map((entry) => entry.openTime), [10_239, 10_240, 10_243]);
});

test("recent appends preserve historical and blank-margin anchors and allow drag to suppress following", () => {
  for (const [start, followLatest] of [[25.5, true], [-50, true], [239, true], [120, false]] as const) {
    const navigation = new ChartNavigation({ ...page(10_000), historyComplete: true }, {
      loadPage: async () => { throw new Error("unexpected history request"); }, onChange: () => {},
    });
    navigation.setViewport({ start, count: 120 });
    navigation.mergeRecentCandles([candle(10_240)], followLatest);
    assert.deepEqual(navigation.viewport, { start, count: 120 });
  }
});

test("a new tail initializes an empty chart and stays right aligned while a sparse series grows", () => {
  const navigation = new ChartNavigation({ candles: [], nextBefore: 10_000 }, {
    loadPage: async () => page(9_760), onChange: () => {},
  });
  navigation.mergeRecentCandles(page(10_000, 9).candles);
  assert.deepEqual(navigation.viewport, { start: 0, count: 9 });
  navigation.mergeRecentCandles([candle(10_009)]);
  assert.deepEqual(navigation.viewport, { start: 0, count: 10 });
  assert.equal(navigation.historyStartReached, false);
});

test("recent appends leave the exclusive older-history cursor unchanged", async () => {
  const beforeValues: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => { beforeValues.push(before); return page(9_760); }, onChange: () => {},
  });
  navigation.mergeRecentCandles([candle(9_999), candle(10_240)]);
  navigation.pan(-200);
  await settle();
  assert.deepEqual(beforeValues, [10_000]);
  assert.equal(navigation.candles.at(-1)?.openTime, 10_240);
});

test("tail eviction preserves surviving time anchors and reports the signed drag-index shift", () => {
  const changes: number[] = [];
  const navigation = new ChartNavigation({ ...page(0, MAX_HISTORY_CANDLES), historyComplete: true }, {
    loadPage: async () => { throw new Error("unexpected history request"); },
    onChange: (shift) => changes.push(shift),
  });
  assert.equal(navigation.historyStartReached, true);
  navigation.setViewport({ start: 1_000.5, count: 120 });
  changes.length = 0;
  navigation.mergeRecentCandles([candle(MAX_HISTORY_CANDLES), candle(MAX_HISTORY_CANDLES + 1)]);
  assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
  assert.equal(navigation.candles[0].openTime, 2);
  assert.deepEqual(navigation.viewport, { start: 998.5, count: 120 });
  assert.equal(navigation.candles[0].openTime + navigation.viewport.start, 1_000.5);
  assert.deepEqual(changes, [-2]);
  assert.equal(navigation.historyStartReached, false);
  assert.match(navigation.historyMessage, /4800/);
  assert.equal(navigation.canLoadOlder, false);
});

test("an aligned latest view follows rolling cache eviction", () => {
  const navigation = new ChartNavigation(page(10_000, MAX_HISTORY_CANDLES), {
    loadPage: async () => page(9_760), onChange: () => {},
  });
  navigation.mergeRecentCandles(page(10_000 + MAX_HISTORY_CANDLES, 3).candles);
  assert.deepEqual(navigation.viewport, { start: MAX_HISTORY_CANDLES - 120, count: 120 });
  assert.equal(navigation.candles.at(-1)?.openTime, 10_000 + MAX_HISTORY_CANDLES + 2);
});

test("a pending zoom retains its pointer time anchor while recent candles arrive", () => {
  const request = deferred<CandleHistoryPage>();
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => request.promise, onChange: () => {},
  });
  navigation.setViewport({ start: 180, count: 120 });
  const anchorTime = navigation.candles[0].openTime + 180 + 120 * 0.25;
  navigation.zoom(0.2, 0.25);
  navigation.mergeRecentCandles(page(10_240, 2).candles);
  assert.equal(navigation.viewport.count, 242);
  assert.equal(navigation.candles[0].openTime + navigation.viewport.start + navigation.viewport.count * 0.25,
    anchorTime);
  assert.equal(navigation.needsOlder, true);
  navigation.mergeRecentCandles(page(10_242, 400).candles);
  assert.equal(navigation.viewport.count, 600);
  assert.equal(navigation.candles[0].openTime + navigation.viewport.start + navigation.viewport.count * 0.25,
    anchorTime);
  assert.equal(navigation.needsOlder, false);
  navigation.cancel();
});

test("an older in-flight page cannot overflow a cache filled by a recent tail", async () => {
  const request = deferred<CandleHistoryPage>();
  const changes: number[] = [];
  const navigation = new ChartNavigation(page(10_000, MAX_HISTORY_CANDLES - 10), {
    loadPage: async () => request.promise, onChange: (shift) => changes.push(shift),
  });
  navigation.setViewport({ start: -1, count: 120 });
  assert.equal(navigation.loadingOlder, true);
  navigation.mergeRecentCandles(page(10_000 + MAX_HISTORY_CANDLES - 10, 20).candles, false);
  assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
  const before = navigation.candles;
  const viewport = navigation.viewport;
  request.resolve({ ...page(9_760), historyComplete: true });
  await settle();
  assert.equal(navigation.candles, before);
  assert.deepEqual(navigation.viewport, viewport);
  assert.equal(navigation.historyStartReached, false);
  assert.equal(navigation.loadingOlder, false);
  assert.equal(changes.includes(-10), true);
  assert.equal(changes.some((shift) => shift > 0), false);
});

test("cancelled navigation ignores recent updates without notifying or replacing its series", () => {
  let changes = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => page(9_760), onChange: () => { changes += 1; },
  });
  const before = navigation.candles;
  navigation.cancel();
  navigation.mergeRecentCandles([candle(10_240)]);
  assert.equal(navigation.candles, before);
  assert.equal(changes, 0);
});

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
  assert.match(navigation.historyMessage, /尚未确认历史起点.*继续查询/);
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
  assert.deepEqual(navigation.viewport, { start: -119, count: 120 });
});

test("completed history and a full cache allow extra zoom without requesting more data", async () => {
  for (const initial of [page(0, 1), page(0, 9), page(0), page(10_000, MAX_HISTORY_CANDLES)]) {
    let requests = 0;
    const clock = fakeClock();
    const navigation = new ChartNavigation(initial, {
      ...clock,
      loadPage: async () => { requests += 1; return page(0); }, onChange: () => {},
    });
    const total = initial.candles.length;
    const reset = navigation.viewport;
    navigation.startPrefetch();
    navigation.setViewport({ start: 0, count: total });
    navigation.zoom(0.8);
    assert.deepEqual(navigation.viewport, { start: -total * 0.25, count: total * 1.25 });
    navigation.zoom(0.01);
    assert.equal(navigation.maximumViewportCount, total * 2);
    assert.deepEqual(navigation.viewport, { start: -total, count: total * 2 });
    navigation.zoom(0.5);
    assert.deepEqual(navigation.viewport, { start: -total, count: total * 2 });
    navigation.zoom(2);
    assert.deepEqual(navigation.viewport, { start: 0, count: total });
    navigation.continueLoading();
    navigation.reset();
    assert.deepEqual(navigation.viewport, reset);
    await clock.advance(10_000);
    assert.equal(requests, 0);
    assert.equal(clock.pending(), 0);
    assert.equal(navigation.historyStartReached, initial.nextBefore === 0);
  }
});

test("pending zoom resolves around its anchor when the final page is empty or partial", async () => {
  for (const added of [0, 60]) {
    for (const requestedCount of [400, 2_400]) {
      const pending = deferred<CandleHistoryPage>();
      let requests = 0;
      const navigation = new ChartNavigation(page(10_000), {
        loadPage: async () => { requests += 1; return pending.promise; }, onChange: () => {},
      });
      const anchor = 0.25;
      const anchorTime = 10_000 + navigation.viewport.start + navigation.viewport.count * anchor;
      navigation.zoom(navigation.viewport.count / requestedCount, anchor);
      assert.equal(navigation.viewport.count, 240);
      pending.resolve({ ...page(10_000 - added, added), historyComplete: true });
      await settle();
      const count = Math.min(requestedCount, (240 + added) * 2);
      assert.equal(navigation.viewport.count, count);
      assert.equal(navigation.candles[0].openTime + navigation.viewport.start + count * anchor, anchorTime);
      assert.equal(navigation.needsOlder, false);
      assert.equal(navigation.historyStartReached, true);
      navigation.continueLoading();
      await settle();
      assert.equal(requests, 1);
    }
  }
});

test("pending zoom gets its blank reserve when either older pages or a live append fills the cache", async () => {
  for (const live of [false, true]) {
    const pending = deferred<CandleHistoryPage>();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000, MAX_HISTORY_CANDLES - 10), {
      loadPage: async () => { requests += 1; return pending.promise; }, onChange: () => {},
    });
    const anchor = 0.25;
    const anchorTime = 10_000 + navigation.viewport.start + navigation.viewport.count * anchor;
    navigation.zoom(0.01, anchor);
    if (live) navigation.mergeRecentCandles(page(10_000 + MAX_HISTORY_CANDLES - 10, 20).candles);
    pending.resolve(page(9_760));
    await settle();
    assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
    assert.equal(navigation.viewport.count, MAX_HISTORY_CANDLES * 2);
    assert.equal(navigation.candles[0].openTime + navigation.viewport.start + navigation.viewport.count * anchor,
      anchorTime);
    assert.equal(navigation.canLoadOlder, false);
    assert.equal(navigation.needsOlder, false);
    assert.equal(navigation.historyStartReached, false);
    assert.match(navigation.historyMessage, /4800.*上限/);
    assert.equal(requests, 1);
  }
});

test("live appends retain the expanded scale and follow only an aligned latest edge", () => {
  for (const initial of [page(0), page(10_000, MAX_HISTORY_CANDLES)]) {
    for (const anchor of [0.5, 1]) {
      const navigation = new ChartNavigation(initial, {
        loadPage: async () => { throw new Error("unexpected request"); }, onChange: () => {},
      });
      const total = initial.candles.length;
      navigation.setViewport({ start: 0, count: total });
      navigation.zoom(0.5, anchor);
      const before = navigation.viewport;
      const startTime = navigation.candles[0].openTime + before.start;
      const nextTime = navigation.candles.at(-1)!.openTime + 1;
      navigation.mergeRecentCandles([candle(nextTime)]);
      assert.equal(navigation.viewport.count, before.count);
      assert.equal(navigation.candles[0].openTime + navigation.viewport.start,
        startTime + (anchor === 1 ? 1 : 0));
      assert.equal(navigation.needsOlder, false);
    }
  }
});

test("a zero cursor honestly stops at the queryable history boundary", async () => {
  const navigation = new ChartNavigation(page(240), {
    loadPage: async () => page(0),
    onChange: () => {},
  });
  navigation.zoom(0.1);
  await settle();
  assert.equal(navigation.candles.length, 480);
  assert.deepEqual(navigation.viewport, { start: -480, count: 960 });
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.historyStartReached, true);
  assert.match(navigation.historyMessage, /历史起点/);
});

test("confirmed origin stops demand and prefetch and keeps its status through pan and reset", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async () => {
      requests += 1;
      return { ...page(9_760), historyComplete: true };
    },
    onChange: () => {},
  });
  navigation.startPrefetch();
  assert.equal(navigation.historyStartReached, false);
  navigation.pan(-500);
  await settle();
  assert.equal(navigation.historyStartReached, true);
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.needsOlder, false);
  assert.equal(navigation.historyMessage, "已到达历史起点");
  navigation.pan(-500);
  navigation.continueLoading();
  navigation.reset();
  await clock.advance(10_000);
  assert.equal(requests, 1);
  assert.equal(clock.pending(), 0);
  assert.equal(navigation.historyMessage, "已到达历史起点");
});

test("confirmed empty older range establishes the first retained candle as the origin", async () => {
  const navigation = new ChartNavigation(page(10_000, 8), {
    loadPage: async () => ({ candles: [], nextBefore: 10_000, historyComplete: true }),
    onChange: () => {},
  });
  navigation.pan(-10);
  await settle();
  assert.equal(navigation.candles[0].openTime, 10_000);
  assert.equal(navigation.historyStartReached, true);
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.viewport.count, 8);
});

test("short pages and four empty windows remain unconfirmed instead of inventing an origin", async () => {
  let calls = 0;
  const navigation = new ChartNavigation(page(10_000, 8), {
    loadPage: async (before) => { calls += 1; return { candles: [], nextBefore: before - 240 }; },
    onChange: () => {},
  });
  assert.equal(navigation.historyStartReached, false);
  navigation.pan(-20);
  await settle();
  assert.equal(calls, 4);
  assert.equal(navigation.historyStartReached, false);
  assert.equal(navigation.canLoadOlder, true);
  assert.equal(navigation.historyMessage, "尚未确认历史起点，可继续查询");
});

test("a confirmed origin discarded at the cache limit never marks the retained edge", async () => {
  const navigation = new ChartNavigation(page(10_000, MAX_HISTORY_CANDLES - 10), {
    loadPage: async () => ({ ...page(9_760), historyComplete: true }),
    onChange: () => {},
  });
  navigation.pan(-MAX_HISTORY_CANDLES);
  await settle();
  assert.equal(navigation.candles[0].openTime, 9_990);
  assert.equal(navigation.historyStartReached, false);
  assert.equal(navigation.canLoadOlder, false);
  assert.match(navigation.historyMessage, /4800.*上限/);
  const truncatedInitial = new ChartNavigation({ ...page(1, MAX_HISTORY_CANDLES + 1), historyComplete: true }, {
    loadPage: async () => { throw new Error("unexpected request"); }, onChange: () => {},
  });
  assert.equal(truncatedInitial.historyStartReached, false);
});

test("an origin exactly filling the cache is confirmed and takes priority over the limit", () => {
  const navigation = new ChartNavigation({ ...page(1, MAX_HISTORY_CANDLES), historyComplete: true }, {
    loadPage: async () => { throw new Error("unexpected request"); }, onChange: () => {},
  });
  assert.equal(navigation.historyStartReached, true);
  assert.equal(navigation.historyMessage, "已到达历史起点");
});

test("confirmed all-empty history stops queries without creating a candle or flag", async () => {
  const navigation = new ChartNavigation({ candles: [], nextBefore: 10_000 }, {
    loadPage: async () => ({ candles: [], nextBefore: 9_760, historyComplete: true }),
    onChange: () => {},
  });
  navigation.continueLoading();
  await settle();
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.historyStartReached, false);
  assert.match(navigation.historyMessage, /暂无可查询/);
});

test("an explicitly unconfirmed zero cursor does not manufacture an origin", () => {
  const navigation = new ChartNavigation({ ...page(0), historyComplete: false }, {
    loadPage: async () => { throw new Error("unexpected request"); }, onChange: () => {},
  });
  assert.equal(navigation.canLoadOlder, false);
  assert.equal(navigation.historyStartReached, false);
  assert.match(navigation.historyMessage, /历史起点尚未确认/);
});

test("invalid query time does not prove that the oldest loaded candle is the origin", async () => {
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { throw new CandleHistoryError("invalid-time", "invalid cursor"); },
    onChange: () => {},
  });
  navigation.pan(-500);
  await settle();
  assert.equal(navigation.historyStartReached, false);
  assert.equal(navigation.canLoadOlder, false);
  assert.match(navigation.historyMessage, /时间无效/);
});

test("a late confirmed origin from a cancelled selection cannot establish a boundary", async () => {
  const pending = deferred<CandleHistoryPage>();
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => pending.promise, onChange: () => {},
  });
  navigation.pan(-500);
  navigation.cancel();
  pending.resolve({ ...page(9_760), historyComplete: true });
  await settle();
  assert.equal(navigation.historyStartReached, false);
  assert.equal(navigation.candles.length, 240);
});

test("origin metadata cooldown preserves candles and pauses demand and speculation", async () => {
  for (const delay of [60_000, 600_000]) {
    const clock = fakeClock();
    let calls = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        calls += 1;
        return { candles: [candle(before - 1)], nextBefore: before - 240,
          ...(calls === 1 ? { olderRetryAfterMs: delay } : { historyComplete: true }) };
      }, onChange: () => {},
    });
    navigation.startPrefetch(); navigation.pan(-500);
    await settle();
    assert.equal(calls, 1);
    assert.equal(navigation.candles.length, 241);
    assert.equal(navigation.historyStartReached, false);
    assert.match(navigation.historyMessage, /请求受限/);
    navigation.continueLoading(); await clock.advance(delay - 1);
    navigation.continueLoading(); await settle(); assert.equal(calls, 1);
    await clock.advance(1); navigation.continueLoading(); await settle();
    assert.equal(calls, 2);
    assert.equal(navigation.historyStartReached, true);
  }
});

test("initial metadata cooldown does not discard the first page or start prefetch", async () => {
  const clock = fakeClock();
  let calls = 0;
  const navigation = new ChartNavigation({ ...page(10_000, 80), olderRetryAfterMs: 60_000 }, {
    ...clock, loadPage: async () => { calls += 1; return page(9_760); }, onChange: () => {},
  });
  navigation.startPrefetch(); await clock.advance(2_000);
  assert.equal(calls, 0); assert.equal(navigation.candles.length, 80);
  navigation.pan(-80); await settle();
  assert.equal(calls, 0); assert.match(navigation.historyMessage, /请求受限/);
  navigation.cancel();
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

test("prefetch warms a bounded left buffer at 250ms per page without moving the visible candles", async () => {
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
  await clock.advance(249);
  assert.deepEqual(requests, []);
  await clock.advance(1);
  assert.deepEqual(requests, [10_000]);
  assert.deepEqual(navigation.viewport, { start: 360, count: 120 });
  assert.equal(navigation.historyMessage, "");
  await clock.advance(250);
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
  await clock.advance(250);
  assert.equal(requests, 1);
  assert.deepEqual(navigation.viewport, { start: 690, count: 120 });
  assert.equal(navigation.candles[690].openTime, firstVisible);
  assert.equal(clock.pending(), 0);
});

test("zoom-out prefetch tracks two visible screens and caps its buffer without stopping after four dense pages", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000, 720), {
    ...clock,
    loadPage: async (before) => { requests += 1; return page(before - 240); },
    onChange: () => {},
  });
  navigation.startPrefetch();
  navigation.zoom(0.25);
  assert.equal(navigation.viewport.count, 480);
  await clock.advance(750);
  assert.equal(requests, 3);
  assert.equal(navigation.viewport.start, 960);
  assert.equal(clock.pending(), 0);

  navigation.zoom(0.5);
  assert.equal(navigation.viewport.count, 960);
  await clock.advance(1_500);
  assert.equal(requests, 9);
  assert.equal(navigation.viewport.start, 1_920);
  assert.equal(clock.pending(), 0);

  navigation.zoom(0.5);
  assert.equal(navigation.viewport.count, 1_920);
  await clock.advance(1_000);
  assert.equal(requests, 13);
  assert.equal(navigation.viewport.start, 1_920);
  assert.equal(navigation.candles.length, 3_840);
  assert.equal(navigation.candles.at(-1)?.openTime, 10_719);
  assert.equal(clock.pending(), 0);
  await clock.advance(100_000);
  assert.equal(requests, 13);
});

test("prefetch spacing starts after a slow response completes and never overlaps requests", async () => {
  const clock = fakeClock();
  const first = deferred<CandleHistoryPage>();
  const started: number[] = [];
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => {
      started.push(clock.now());
      return started.length === 1 ? first.promise : page(before - 240);
    },
    onChange: () => {},
  });
  navigation.startPrefetch();
  await clock.advance(1_250);
  assert.deepEqual(started, [250]);
  assert.equal(clock.pending(), 0);
  first.resolve(page(9_760));
  await settle();
  await clock.advance(249);
  assert.deepEqual(started, [250]);
  await clock.advance(1);
  assert.deepEqual(started, [250, 1_500]);
  assert.equal(navigation.candles.length, 720);
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

test("demand arriving during prefetch reuses its request and continues paced foreground batches", async () => {
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
  await clock.advance(250);
  navigation.zoom(0.01);
  assert.equal(requests.length, 1);
  assert.match(navigation.historyMessage, /正在加载/);
  pending.resolve(page(9_760));
  await settle();
  assert.equal(peakInFlight, 1);
  assert.deepEqual(requests, [10_000, 9_760, 9_520, 9_280]);
  assert.equal(navigation.candles.length, 1_200);
  assert.equal(navigation.needsOlder, true);
  assert.match(navigation.historyMessage, /正在加载/);
  assert.equal(clock.pending(), 1);
  assert.equal(navigation.loadingOlder, true);
  await clock.advance(499);
  assert.equal(requests.length, 4);
  await clock.advance(1);
  assert.equal(requests.length, 8);
  assert.equal(peakInFlight, 1);
  navigation.cancel();
  assert.equal(clock.pending(), 0);
});

test("dense history automatically fulfills a large zoom in paced batches up to the real cache limit", async () => {
  const clock = fakeClock();
  const started: number[] = [];
  const renderedCounts: number[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => {
      started.push(clock.now());
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await settle();
      inFlight -= 1;
      return page(before - 240);
    },
    onChange: (added) => {
      if (added > 0) renderedCounts.push(navigation.viewport.count);
    },
  });
  navigation.zoom(0.01);
  for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) await settle();
  assert.deepEqual(renderedCounts, [480, 720, 960, 1_200]);
  assert.equal(started.length, 4);
  assert.equal(clock.pending(), 1);
  await clock.advance(499);
  assert.equal(started.length, 4);
  for (let batch = 0; batch < 4; batch += 1) {
    await clock.advance(batch === 0 ? 1 : 500);
    for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) await settle();
  }
  assert.equal(started.length, 19);
  assert.equal(peakInFlight, 1);
  assert.deepEqual(started, [
    0, 0, 0, 0, 500, 500, 500, 500, 1_000, 1_000, 1_000, 1_000,
    1_500, 1_500, 1_500, 1_500, 2_000, 2_000, 2_000,
  ]);
  assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
  assert.deepEqual(navigation.viewport, { start: -4_800, count: 9_600 });
  assert.equal(navigation.needsOlder, false);
  assert.equal(navigation.loadingOlder, false);
  assert.equal(clock.pending(), 0);
  await clock.advance(100_000);
  assert.equal(started.length, 19);
});

for (const action of ["reset", "zoom-in", "End", "loaded-pan", "cancel"] as const) {
  test(`${action} cancels a queued dense-history batch without restoring the old zoom`, async () => {
    const clock = fakeClock();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => { requests += 1; return page(before - 240); },
      onChange: () => {},
    });
    navigation.zoom(0.01);
    await settle();
    assert.equal(requests, 4);
    assert.equal(clock.pending(), 1);
    if (action === "reset") navigation.reset();
    else if (action === "zoom-in") navigation.zoom(2);
    else if (action === "End") navigation.pan(Number.POSITIVE_INFINITY);
    else if (action === "loaded-pan") navigation.setViewport({ start: 100, count: 120 });
    else navigation.cancel();
    const visible = navigation.viewport;
    assert.equal(clock.pending(), 0);
    assert.equal(navigation.loadingOlder, false);
    await clock.advance(10_000);
    assert.equal(requests, 4);
    assert.deepEqual(navigation.viewport, visible);
  });
}

test("a queued dense batch honors a replacement historical range without bypassing its pacing", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async (before) => { requests += 1; return page(before - 240); },
    onChange: () => {},
  });
  navigation.zoom(0.01);
  await settle();
  navigation.setViewport({ start: -100, count: 120 });
  assert.match(navigation.historyMessage, /正在加载/);
  const firstVisible = navigation.candles[0].openTime + navigation.viewport.start;
  await clock.advance(499);
  assert.equal(requests, 4);
  await clock.advance(1);
  assert.equal(requests, 5);
  assert.deepEqual(navigation.viewport, { start: 140, count: 120 });
  assert.equal(navigation.candles[0].openTime + navigation.viewport.start, firstVisible);
  assert.equal(navigation.needsOlder, false);
  assert.equal(clock.pending(), 0);
});

test("a live append reaching the cache cap cancels queued older work and resolves the pending scale", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000, 3_600), {
    ...clock,
    loadPage: async (before) => { requests += 1; return page(before - 240); },
    onChange: () => {},
  });
  navigation.zoom(0.01);
  await settle();
  assert.equal(requests, 4);
  assert.equal(clock.pending(), 1);
  navigation.mergeRecentCandles(page(13_600).candles);
  assert.equal(navigation.candles.length, MAX_HISTORY_CANDLES);
  assert.equal(navigation.viewport.count, 9_600);
  assert.equal(clock.pending(), 0);
  await clock.advance(10_000);
  assert.equal(requests, 4);
});

for (const failure of ["sparse", "empty", "duplicate", "nonadvancing", "network"] as const) {
  test(`${failure} history stops dense automatic continuation and repeated gestures cannot restart it`, async () => {
    const clock = fakeClock();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        requests += 1;
        if (requests !== 8) return page(before - 240);
        if (failure === "network") throw new Error("offline");
        return {
          candles: failure === "sparse" ? [candle(before - 1)]
            : failure === "duplicate" ? page(before).candles : [],
          nextBefore: failure === "nonadvancing" ? before : before - 240,
        };
      },
      onChange: () => {},
    });
    navigation.zoom(0.01);
    await settle();
    await clock.advance(500);
    assert.equal(requests, 8);
    assert.equal(navigation.needsOlder, true);
    assert.equal(clock.pending(), 0);
    for (let gesture = 0; gesture < 50; gesture += 1) {
      navigation.setViewport({ start: -119, count: 120 });
      navigation.zoom(0.9);
      await settle();
    }
    await clock.advance(10_000);
    assert.equal(requests, 8);
    assert.equal(clock.pending(), 0);
    navigation.continueLoading();
    await settle();
    assert.equal(requests, 9);
    assert.equal(navigation.needsOlder, false);
  });
}

for (const status of [429, 403]) {
  test(`HTTP ${status} during an automatic batch stops all continuation until explicit retry after cooldown`, async () => {
    const clock = fakeClock();
    const cooldown = status === 403 ? 600_000 : 60_000;
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        requests += 1;
        if (requests === 5) throw new CandleHistoryError("http", "rate limited", status);
        return page(before - 240);
      },
      onChange: () => {},
    });
    navigation.zoom(0.01);
    await settle();
    await clock.advance(500);
    assert.equal(requests, 5);
    assert.equal(clock.pending(), 0);
    assert.match(navigation.historyMessage, /请求受限/);
    await clock.advance(cooldown - 1);
    navigation.continueLoading();
    assert.equal(requests, 5);
    await clock.advance(1);
    assert.equal(requests, 5);
    navigation.continueLoading();
    await settle();
    assert.equal(requests, 9);
    navigation.cancel();
    assert.equal(clock.pending(), 0);
  });
}

test("origin metadata cooldown on the fourth full page prevents a healthy batch from scheduling continuation", async () => {
  for (const delay of [60_000, 600_000]) {
    const clock = fakeClock();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      ...clock,
      loadPage: async (before) => {
        requests += 1;
        return { ...page(before - 240), ...(requests === 4 ? { olderRetryAfterMs: delay } : {}) };
      },
      onChange: () => {},
    });
    navigation.zoom(0.01);
    await settle();
    assert.equal(requests, 4);
    assert.equal(navigation.candles.length, 1_200);
    assert.equal(clock.pending(), 0);
    assert.equal(navigation.loadingOlder, false);
    assert.match(navigation.historyMessage, /请求受限/);
    await clock.advance(delay - 1);
    navigation.continueLoading();
    assert.equal(requests, 4);
    await clock.advance(1);
    assert.equal(requests, 4);
    navigation.continueLoading();
    await settle();
    assert.equal(requests, 8);
    assert.equal(navigation.loadingOlder, true);
    navigation.cancel();
  }
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
    await clock.advance(250);
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

test("dense prefetch pages do not reset the four-sparse-page budget within the same refill", async () => {
  const clock = fakeClock();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000, 1_200), {
    ...clock,
    loadPage: async (before) => {
      requests += 1;
      return requests % 2 === 0 ? page(before - 240)
        : { candles: [candle(before - 1)], nextBefore: before - 240 };
    },
    onChange: () => {},
  });
  navigation.setViewport({ start: 240, count: 960 });
  navigation.startPrefetch();
  await clock.advance(100_000);
  assert.equal(requests, 7);
  assert.equal(navigation.candles.length, 1_924);
  assert.deepEqual(navigation.viewport, { start: 964, count: 960 });
  assert.equal(clock.pending(), 0);
  assert.equal(navigation.needsOlder, false);
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
    await clock.advance(250);
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

test("both data ends allow blank-space pan even when all data are visible or history cannot grow", () => {
  let requests = 0;
  for (const initial of [page(0, 1), page(0, 8), page(0), page(10_000, MAX_HISTORY_CANDLES)]) {
    const navigation = new ChartNavigation(initial, {
      loadPage: async () => { requests += 1; return page(0); },
      onChange: () => {},
    });
    const count = navigation.viewport.count;
    const geometry = candleBarGeometry(1_200, count);
    navigation.pan(-1e300);
    assert.deepEqual(navigation.viewport, { start: 1 - count, count });
    assert.deepEqual(candleViewportBounds(navigation.viewport, navigation.candles.length), {
      startIndex: 0, endIndex: 1,
    });
    navigation.pan(1e300);
    assert.deepEqual(navigation.viewport, { start: initial.candles.length - 1, count });
    assert.deepEqual(candleViewportBounds(navigation.viewport, navigation.candles.length), {
      startIndex: initial.candles.length - 1, endIndex: initial.candles.length,
    });
    assert.deepEqual(candleBarGeometry(1_200, navigation.viewport.count), geometry);
    navigation.pan(Number.POSITIVE_INFINITY);
    assert.deepEqual(navigation.viewport, { start: initial.candles.length - count, count });
    assert.equal(navigation.needsOlder, false);
  }
  assert.equal(requests, 0);
});

test("an extreme older drag bounds its demand and preserves the end candle while a page is pending", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.pan(Number.NEGATIVE_INFINITY);
  assert.deepEqual(navigation.viewport, { start: -119, count: 120 });
  assert.equal(requests, 1);
  const oldCandlePosition = 0.5 - navigation.viewport.start;
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 121, count: 120 });
  assert.equal(240.5 - navigation.viewport.start, oldCandlePosition);
  assert.equal(navigation.needsOlder, false);
  assert.equal(requests, 1);
});

test("a sparse older response fills blank space without stretching or moving the loaded candles", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => {
      requests += 1;
      if (requests === 1) return pending.promise;
      return { candles: [], nextBefore: before - 240 };
    },
    onChange: () => {},
  });
  navigation.setViewport({ start: -80.25, count: 120 });
  pending.resolve({ candles: [candle(9_997), candle(9_999)], nextBefore: 9_760 });
  await settle();
  assert.equal(requests, 4);
  assert.deepEqual(navigation.viewport, { start: -78.25, count: 120 });
  assert.deepEqual(candleViewportBounds(navigation.viewport, 242), { startIndex: 0, endIndex: 42 });
  assert.equal(navigation.needsOlder, true);
  assert.match(navigation.historyMessage, /尚未确认历史起点.*继续查询/);
});

test("starting a drag while a large zoom waits uses the visible scale and clears hidden demand", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.zoom(0.01);
  assert.deepEqual(navigation.viewport, { start: 0, count: 240 });
  navigation.pan(1e300);
  assert.deepEqual(navigation.viewport, { start: 239, count: 240 });
  assert.equal(navigation.needsOlder, false);
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 479, count: 240 });
  assert.equal(requests, 1);
});

for (const action of ["reset", "zoom-in", "End"] as const) {
  test(`${action} after an older blank-space drag wins over late history`, async () => {
    const pending = deferred<CandleHistoryPage>();
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      loadPage: async () => { requests += 1; return pending.promise; },
      onChange: () => {},
    });
    navigation.pan(-1e300);
    if (action === "reset") navigation.reset();
    else if (action === "zoom-in") navigation.zoom(2, 1);
    else navigation.pan(Number.POSITIVE_INFINITY);
    const current = navigation.viewport;
    pending.resolve(page(9_760));
    await settle();
    assert.deepEqual(navigation.viewport, { start: current.start + 240, count: current.count });
    assert.equal(navigation.needsOlder, false);
    assert.equal(requests, 1);
  });
}

test("prefetch prepends behind a newer blank-space pan without changing its scale or latest position", async () => {
  const clock = fakeClock();
  const pending = deferred<CandleHistoryPage>();
  const navigation = new ChartNavigation(page(10_000), {
    ...clock,
    loadPage: async () => pending.promise,
    onChange: () => {},
  });
  navigation.startPrefetch();
  await clock.advance(250);
  navigation.pan(1e300);
  assert.deepEqual(navigation.viewport, { start: 239, count: 120 });
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 479, count: 120 });
  assert.equal(navigation.candles.length - 0.5 - navigation.viewport.start, 0.5);
  navigation.cancel();
});

test("zooming out in newer blank space still fulfills its requested scale from bounded history", async () => {
  const pending = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => { requests += 1; return pending.promise; },
    onChange: () => {},
  });
  navigation.pan(1e300);
  navigation.zoom(0.25, 0);
  assert.equal(requests, 1);
  assert.deepEqual(navigation.viewport, { start: 239, count: 240 });
  pending.resolve(page(9_760));
  await settle();
  assert.deepEqual(navigation.viewport, { start: 479, count: 480 });
  assert.equal(navigation.needsOlder, false);
  assert.equal(requests, 1);
});

test("a progressive larger zoom retains its pointer anchor through blank space and successive pages", async () => {
  const first = deferred<CandleHistoryPage>();
  const second = deferred<CandleHistoryPage>();
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async () => ++requests === 1 ? first.promise : second.promise,
    onChange: () => {},
  });
  navigation.setViewport({ start: 180, count: 120 });
  const anchor = navigation.candles[0].openTime + 180 + 120 * 0.25;
  const visibleAnchor = (): number => navigation.candles[0].openTime
    + navigation.viewport.start + navigation.viewport.count * 0.25;
  navigation.zoom(0.2, 0.25);
  assert.equal(navigation.viewport.count, 240);
  assert.equal(visibleAnchor(), anchor);
  first.resolve(page(9_760));
  await settle();
  assert.equal(requests, 2);
  assert.equal(navigation.viewport.count, 480);
  assert.equal(visibleAnchor(), anchor);
  second.resolve(page(9_520));
  await settle();
  assert.equal(navigation.viewport.count, 600);
  assert.equal(visibleAnchor(), anchor);
  assert.equal(navigation.needsOlder, false);
});

test("an empty series remains empty under both pan directions and zoom", () => {
  let requests = 0;
  const navigation = new ChartNavigation({ candles: [], nextBefore: 10_000 }, {
    loadPage: async () => { requests += 1; return page(9_760); },
    onChange: () => {},
  });
  navigation.pan(Number.NEGATIVE_INFINITY);
  navigation.pan(1e300);
  navigation.zoom(0.01);
  assert.deepEqual(navigation.viewport, { start: 0, count: 0 });
  assert.equal(requests, 0);
});

for (const failure of ["http", "nonadvancing"] as const) {
  test(`${failure} demand stops repeated drag retries at the same cursor until explicit continuation`, async () => {
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      loadPage: async (before) => {
        requests += 1;
        if (requests === 1) {
          if (failure === "http") throw new CandleHistoryError("http", "unavailable", 503);
          return { candles: [], nextBefore: before };
        }
        return page(before - 240);
      },
      onChange: () => {},
    });
    navigation.setViewport({ start: -1, count: 120 });
    await settle();
    const failureMessage = navigation.historyMessage;
    assert.match(failureMessage, /重试/);
    for (let move = 1; move <= 50; move += 1) {
      navigation.setViewport({ start: -move, count: 120 });
      await settle();
    }
    assert.equal(requests, 1);
    assert.equal(navigation.historyMessage, failureMessage);
    assert.deepEqual(navigation.viewport, { start: -50, count: 120 });
    assert.equal(navigation.needsOlder, true);
    navigation.continueLoading();
    await settle();
    assert.equal(requests, 2);
    assert.deepEqual(navigation.viewport, { start: 190, count: 120 });
    assert.equal(navigation.needsOlder, false);
    assert.equal(navigation.historyMessage, "");
  });
}

test("four sparse demand pages stay bounded while a held older drag keeps moving", async () => {
  let requests = 0;
  const navigation = new ChartNavigation(page(10_000), {
    loadPage: async (before) => {
      requests += 1;
      return { candles: [candle(before - 1)], nextBefore: before - 240 };
    },
    onChange: () => {},
  });
  navigation.pan(-1e300);
  await settle();
  assert.equal(requests, 4);
  assert.deepEqual(navigation.viewport, { start: -115, count: 120 });
  for (let move = 0; move < 50; move += 1) {
    navigation.setViewport({ start: -119, count: 120 });
    await settle();
  }
  assert.equal(requests, 4);
  assert.match(navigation.historyMessage, /尚未确认历史起点.*继续查询/);
  navigation.continueLoading();
  await settle();
  assert.equal(requests, 8);
  assert.deepEqual(navigation.viewport, { start: -115, count: 120 });
});

for (const retreat of ["pan", "reset"] as const) {
  test(`${retreat} to loaded candles permits one fresh later demand after a paused failure`, async () => {
    let requests = 0;
    const navigation = new ChartNavigation(page(10_000), {
      loadPage: async () => { requests += 1; throw new Error("offline"); },
      onChange: () => {},
    });
    navigation.pan(-121);
    await settle();
    assert.equal(requests, 1);
    if (retreat === "pan") navigation.setViewport({ start: 0, count: 120 });
    else navigation.reset();
    assert.equal(navigation.needsOlder, false);
    navigation.setViewport({ start: -1, count: 120 });
    await settle();
    assert.equal(requests, 2);
    navigation.pan(-1);
    await settle();
    assert.equal(requests, 2);
  });
}
