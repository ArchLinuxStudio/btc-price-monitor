import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_VISIBLE_CANDLES,
  MIN_VISIBLE_CANDLES,
  candleBarGeometry,
  candleViewportBounds,
  createCandleViewport,
  isCandleViewportFull,
  isCandleViewportReset,
  normalizeCandleViewport,
  panCandleViewport,
  prependCandleViewport,
  zoomCandleViewport,
} from "../src/chart-viewport.ts";

test("creates a newest-120-candles reset viewport and handles empty or tiny series", () => {
  assert.equal(DEFAULT_VISIBLE_CANDLES, 120);
  assert.deepEqual(createCandleViewport(240), { start: 120, count: 120 });
  assert.deepEqual(createCandleViewport(0), { start: 0, count: 0 });
  assert.deepEqual(createCandleViewport(1), { start: 0, count: 1 });
  assert.deepEqual(createCandleViewport(8, 2), { start: 0, count: 8 });
  assert.deepEqual(createCandleViewport(-4), { start: 0, count: 0 });
  assert.deepEqual(createCandleViewport(Number.NaN), { start: 0, count: 0 });
  assert.deepEqual(createCandleViewport(Number.POSITIVE_INFINITY), { start: 0, count: 0 });
});

test("optional initial count is clamped and aligned to the newest candle", () => {
  assert.deepEqual(createCandleViewport(100, 40), { start: 60, count: 40 });
  assert.deepEqual(createCandleViewport(100, 2), {
    start: 100 - MIN_VISIBLE_CANDLES,
    count: MIN_VISIBLE_CANDLES,
  });
  assert.deepEqual(createCandleViewport(100, Number.POSITIVE_INFINITY), {
    start: 0,
    count: 100,
  });
  assert.deepEqual(createCandleViewport(100, Number.NEGATIVE_INFINITY), {
    start: 88,
    count: 12,
  });
  assert.deepEqual(createCandleViewport(100, Number.NaN), { start: 0, count: 100 });
  assert.deepEqual(createCandleViewport(100.9, 20), { start: 80, count: 20 });
});

test("normalizes count and continuous start without mutating input", () => {
  const input = { start: 14.75, count: 24.5 };
  assert.deepEqual(normalizeCandleViewport(input, 100), input);
  assert.deepEqual(input, { start: 14.75, count: 24.5 });

  assert.deepEqual(normalizeCandleViewport({ start: -10, count: 5 }, 100), {
    start: 0,
    count: 12,
  });
  assert.deepEqual(normalizeCandleViewport({ start: 999, count: 20 }, 100), {
    start: 80,
    count: 20,
  });
  assert.deepEqual(normalizeCandleViewport({ start: Number.NaN, count: 20 }, 100), {
    start: 0,
    count: 20,
  });
  assert.deepEqual(
    normalizeCandleViewport({ start: Number.POSITIVE_INFINITY, count: 20 }, 100),
    { start: 80, count: 20 },
  );
  assert.deepEqual(
    normalizeCandleViewport({ start: Number.NEGATIVE_INFINITY, count: 20 }, 100),
    { start: 0, count: 20 },
  );
  assert.deepEqual(
    normalizeCandleViewport({ start: 20, count: Number.POSITIVE_INFINITY }, 100),
    { start: 0, count: 100 },
  );
  assert.deepEqual(
    normalizeCandleViewport({ start: 20, count: Number.NEGATIVE_INFINITY }, 100),
    { start: 20, count: 12 },
  );
  assert.deepEqual(normalizeCandleViewport({ start: 20, count: Number.NaN }, 100), {
    start: 0,
    count: 100,
  });
});

test("detects the reset state after normalization", () => {
  assert.equal(isCandleViewportReset(createCandleViewport(100), 100), true);
  assert.equal(isCandleViewportReset({ start: -5, count: 500 }, 100), true);
  assert.equal(isCandleViewportReset({ start: 0, count: 99 }, 100), false);
  assert.equal(isCandleViewportReset({ start: 1, count: 50 }, 100), false);
  assert.equal(isCandleViewportReset({ start: 10, count: 1 }, 8), true);
  assert.equal(isCandleViewportReset({ start: 999, count: 999 }, 0), true);
});

test("distinguishes the default reset view from the full loaded history", () => {
  const initial = createCandleViewport(240);
  assert.equal(isCandleViewportReset(initial, 240), true);
  assert.equal(isCandleViewportFull(initial, 240), false);
  assert.equal(isCandleViewportReset({ start: 0, count: 240 }, 240), false);
  assert.equal(isCandleViewportFull({ start: 0, count: 240 }, 240), true);
  assert.equal(isCandleViewportReset({ start: 100, count: 120 }, 240), false);
  assert.equal(isCandleViewportFull({ start: 0, count: 239 }, 240), false);
  assert.equal(isCandleViewportFull({ start: -5, count: 500 }, 240), true);
  for (const total of [0, 1, 12, 100, 120]) {
    assert.equal(isCandleViewportReset(createCandleViewport(total), total), true);
    assert.equal(isCandleViewportFull(createCandleViewport(total), total), true);
  }
});

test("initial zoom-out reveals older candles and contracts their spacing and bodies", () => {
  const initial = createCandleViewport(240);
  const zoomedOut = zoomCandleViewport(initial, 240, 0.5, 1);
  const initialGeometry = candleBarGeometry(1200, initial.count);
  const zoomedOutGeometry = candleBarGeometry(1200, zoomedOut.count);
  assert.deepEqual(zoomedOut, { start: 0, count: 240 });
  assert.equal(initial.start + initial.count, zoomedOut.start + zoomedOut.count);
  assert.ok(zoomedOut.count > initial.count);
  assert.ok(zoomedOutGeometry.spacing < initialGeometry.spacing);
  assert.ok(zoomedOutGeometry.bodyWidth < initialGeometry.bodyWidth);

  const zoomedBackIn = zoomCandleViewport(zoomedOut, 240, 2, 1);
  assert.deepEqual(zoomedBackIn, initial);
  assert.deepEqual(candleBarGeometry(1200, zoomedBackIn.count), initialGeometry);
});

test("candle bodies keep the same slot ratio across scales without a twelve-pixel cap", () => {
  assert.deepEqual(candleBarGeometry(1200, 12), { spacing: 100, bodyWidth: 72 });
  const counts = [12, 24, 48, 120, 240, 480];
  let previousSpacing = Number.POSITIVE_INFINITY;
  let previousBodyWidth = Number.POSITIVE_INFINITY;
  for (const count of counts) {
    const { spacing, bodyWidth } = candleBarGeometry(1200, count);
    assert.ok(spacing < previousSpacing);
    assert.ok(bodyWidth < previousBodyWidth);
    assert.equal(bodyWidth, spacing * 0.72);
    previousSpacing = spacing;
    previousBodyWidth = bodyWidth;
  }
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(candleBarGeometry(invalid, 120), { spacing: 0, bodyWidth: 0 });
    assert.deepEqual(candleBarGeometry(1200, invalid), { spacing: 0, bodyWidth: 0 });
  }
  assert.equal(candleBarGeometry(10, 0.5).spacing, 10);
  assert.ok(Math.abs(candleBarGeometry(10, 0.5).bodyWidth - 7.2) < 1e-12);
  assert.equal(Number.isFinite(candleBarGeometry(Number.MAX_VALUE, Number.MIN_VALUE).spacing), true);
});

test("prepending history retains fractional candle anchors and visible count", () => {
  const viewport = { start: 22.25, count: 80.5 };
  const prepended = prependCandleViewport(viewport, 240, 100);
  assert.deepEqual(prepended, { start: 122.25, count: 80.5 });
  for (const anchor of [0, 0.25, 0.5, 1]) {
    assert.equal(
      prepended.start + prepended.count * anchor - 100,
      viewport.start + viewport.count * anchor,
    );
  }
  assert.deepEqual(viewport, { start: 22.25, count: 80.5 });
  assert.deepEqual(prependCandleViewport({ start: 0, count: 240 }, 240, 100), {
    start: 100,
    count: 240,
  });
  assert.deepEqual(prependCandleViewport(createCandleViewport(240), 240, 100), {
    start: 220,
    count: 120,
  });
  assert.deepEqual(prependCandleViewport(viewport, 240, 0), viewport);
  assert.deepEqual(prependCandleViewport(viewport, 240, -100), viewport);
  assert.deepEqual(prependCandleViewport(viewport, 240, Number.NaN), viewport);
  assert.deepEqual(prependCandleViewport({ start: 0, count: 0 }, 0, 240), {
    start: 120,
    count: 120,
  });
});

test("zooms around an anchor while preserving its data position", () => {
  const viewport = { start: 25, count: 50 };
  const center = zoomCandleViewport(viewport, 100, 2, 0.5);
  const left = zoomCandleViewport(viewport, 100, 2, 0);
  const right = zoomCandleViewport(viewport, 100, 2, 1);

  assert.deepEqual(center, { start: 37.5, count: 25 });
  assert.deepEqual(left, { start: 25, count: 25 });
  assert.deepEqual(right, { start: 50, count: 25 });
  assert.equal(center.start + center.count * 0.5, viewport.start + viewport.count * 0.5);
  assert.equal(left.start, viewport.start);
  assert.equal(right.start + right.count, viewport.start + viewport.count);
});

test("zoom clamps anchors, counts, boundaries, and extreme scales", () => {
  const viewport = { start: 25, count: 50 };
  assert.deepEqual(zoomCandleViewport(viewport, 100, 2, -50), { start: 25, count: 25 });
  assert.deepEqual(zoomCandleViewport(viewport, 100, 2, 50), { start: 50, count: 25 });
  assert.deepEqual(zoomCandleViewport(viewport, 100, 2, Number.NaN), {
    start: 37.5,
    count: 25,
  });
  assert.deepEqual(zoomCandleViewport(viewport, 100, Number.POSITIVE_INFINITY, 0.5), {
    start: 44,
    count: 12,
  });
  assert.deepEqual(zoomCandleViewport(viewport, 100, Number.MIN_VALUE, 0.5), {
    start: 0,
    count: 100,
  });
  assert.deepEqual(zoomCandleViewport({ start: 0, count: 100 }, 100, 0.5, 0), {
    start: 0,
    count: 100,
  });
  assert.deepEqual(zoomCandleViewport(viewport, 100, 2, Number.NEGATIVE_INFINITY), {
    start: 25,
    count: 25,
  });
  assert.deepEqual(zoomCandleViewport(viewport, 100, 2, Number.POSITIVE_INFINITY), {
    start: 50,
    count: 25,
  });
  assert.deepEqual(zoomCandleViewport(viewport, 100, 0, 0.5), viewport);
  assert.deepEqual(zoomCandleViewport(viewport, 100, -2, 0.5), viewport);
  assert.deepEqual(zoomCandleViewport(viewport, 100, Number.NaN, 0.5), viewport);
  assert.deepEqual(zoomCandleViewport({ start: 0, count: 8 }, 8, 100, 0.5), {
    start: 0,
    count: 8,
  });
});

test("pans smoothly by fractional candle counts and clamps at both ends", () => {
  const viewport = { start: 20, count: 40 };
  assert.deepEqual(panCandleViewport(viewport, 100, 3.25), { start: 23.25, count: 40 });
  assert.deepEqual(panCandleViewport(viewport, 100, -7.5), { start: 12.5, count: 40 });
  assert.deepEqual(panCandleViewport(viewport, 100, -1_000_000), { start: 0, count: 40 });
  assert.deepEqual(panCandleViewport(viewport, 100, 1_000_000), { start: 60, count: 40 });
  assert.deepEqual(panCandleViewport(viewport, 100, Number.NEGATIVE_INFINITY), {
    start: 0,
    count: 40,
  });
  assert.deepEqual(panCandleViewport(viewport, 100, Number.POSITIVE_INFINITY), {
    start: 60,
    count: 40,
  });
  assert.deepEqual(panCandleViewport(viewport, 100, Number.NaN), viewport);
  assert.deepEqual(panCandleViewport(viewport, 100, 0), viewport);
  assert.deepEqual(panCandleViewport({ start: 0, count: 1 }, 1, 999), {
    start: 0,
    count: 1,
  });
});

test("returns half-open integer bounds covering fractional viewport edges", () => {
  assert.deepEqual(candleViewportBounds({ start: 20, count: 40 }, 100), {
    startIndex: 20,
    endIndex: 60,
  });
  assert.deepEqual(candleViewportBounds({ start: 20.25, count: 40.5 }, 100), {
    startIndex: 20,
    endIndex: 61,
  });
  assert.deepEqual(candleViewportBounds({ start: 87.5, count: 12 }, 100), {
    startIndex: 87,
    endIndex: 100,
  });
  assert.deepEqual(candleViewportBounds({ start: 99, count: 999 }, 100), {
    startIndex: 0,
    endIndex: 100,
  });
  assert.deepEqual(candleViewportBounds({ start: 0, count: 1 }, 1), {
    startIndex: 0,
    endIndex: 1,
  });
  assert.deepEqual(candleViewportBounds({ start: 999, count: 999 }, 0), {
    startIndex: 0,
    endIndex: 0,
  });
});

test("all operations preserve finite clamped viewport invariants", () => {
  const totals = [0, 1, 11, 12, 13, 240, Number.NaN, Number.POSITIVE_INFINITY];
  const values = [
    Number.NEGATIVE_INFINITY,
    -1e300,
    -1,
    -0.25,
    0,
    0.25,
    1,
    12,
    1e300,
    Number.POSITIVE_INFINITY,
    Number.NaN,
  ];

  for (const total of totals) {
    const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
    for (const start of values) {
      for (const count of values) {
        const normalized = normalizeCandleViewport({ start, count }, total);
        assert.equal(Number.isFinite(normalized.start), true);
        assert.equal(Number.isFinite(normalized.count), true);
        assert.ok(normalized.start >= 0);
        assert.ok(normalized.count >= Math.min(MIN_VISIBLE_CANDLES, safeTotal));
        assert.ok(normalized.count <= safeTotal);
        assert.ok(normalized.start + normalized.count <= safeTotal);
      }
    }
  }
});
