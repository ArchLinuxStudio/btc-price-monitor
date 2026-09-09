import test from "node:test";
import assert from "node:assert/strict";

import { projectChartCrosshair } from "../src/chart-crosshair.ts";

const plot = { left: 16, top: 22, width: 1_200, height: 600 };
const viewport = { start: 120, count: 120 };
const prices = { low: 90, high: 150 };

test("snaps the vertical guide to a candle while preserving the pointer price", () => {
  assert.deepEqual(projectChartCrosshair({ x: 28, y: 222 }, plot, viewport, 240, prices), {
    index: 121,
    x: 31,
    y: 222,
    price: 130,
  });
});

test("both plot edges select visible real candles and price extrema", () => {
  assert.deepEqual(projectChartCrosshair({ x: 16, y: 22 }, plot, viewport, 240, prices), {
    index: 120,
    x: 21,
    y: 22,
    price: 150,
  });
  assert.deepEqual(projectChartCrosshair({ x: 1_216, y: 622 }, plot, viewport, 240, prices), {
    index: 239,
    x: 1_211,
    y: 622,
    price: 90,
  });
});

test("fractional pan excludes a clipped candle whose center is outside the plot", () => {
  const fractional = { start: 10.75, count: 12.5 };
  const smallPlot = { left: 20, top: 10, width: 250, height: 100 };
  assert.deepEqual(projectChartCrosshair({ x: 20, y: 60 }, smallPlot, fractional, 100, prices), {
    index: 11,
    x: 35,
    y: 60,
    price: 120,
  });
  assert.deepEqual(projectChartCrosshair({ x: 270, y: 60 }, smallPlot, fractional, 100, prices), {
    index: 22,
    x: 255,
    y: 60,
    price: 120,
  });
});

test("centers exactly on a plot boundary remain selectable", () => {
  const fractional = { start: 10.5, count: 12 };
  assert.equal(projectChartCrosshair({ x: 16, y: 22 }, plot, fractional, 100, prices)?.index, 10);
  assert.equal(projectChartCrosshair({ x: 1_216, y: 22 }, plot, fractional, 100, prices)?.index, 22);
});

test("resizing preserves the same candle and price at the same relative pointer location", () => {
  const large = projectChartCrosshair({ x: 319, y: 172 }, plot, viewport, 240, prices);
  const resized = projectChartCrosshair(
    { x: 167.5, y: 97 },
    { ...plot, width: 600, height: 300 },
    viewport,
    240,
    prices,
  );
  assert.ok(large);
  assert.ok(resized);
  assert.equal(resized.index, large.index);
  assert.equal(resized.price, large.price);
  assert.equal(resized.x - plot.left, (large.x - plot.left) / 2);
});

test("prepending history retains the same screen position and adjusts only the index", () => {
  const before = projectChartCrosshair({ x: 319, y: 172 }, plot, viewport, 240, prices);
  const after = projectChartCrosshair(
    { x: 319, y: 172 }, plot, { start: viewport.start + 240, count: viewport.count }, 480, prices,
  );
  assert.ok(before);
  assert.notEqual(before.index, null);
  if (before.index === null) throw new Error("Expected a real candle");
  assert.deepEqual(after, { ...before, index: before.index + 240 });
});

test("empty margins keep guides at the pointer without inventing a candle or timestamp", () => {
  for (const view of [{ start: -119, count: 120 }, { start: 239, count: 120 }]) {
    assert.deepEqual(projectChartCrosshair({ x: 616, y: 322 }, plot, view, 240, prices), {
      index: null, x: 616, y: 322, price: 120,
    });
  }
  assert.equal(projectChartCrosshair({ x: 1_211, y: 322 }, plot, { start: -119, count: 120 }, 240, prices)?.index, 0);
  assert.equal(projectChartCrosshair({ x: 21, y: 322 }, plot, { start: 239, count: 120 }, 240, prices)?.index, 239);
});

test("fractional blank-to-candle transitions do not borrow the endpoint timestamp", () => {
  const view = { start: -0.5, count: 12 };
  assert.equal(projectChartCrosshair({ x: 65, y: 322 }, plot, view, 240, prices)?.index, null);
  assert.equal(projectChartCrosshair({ x: 66, y: 322 }, plot, view, 240, prices)?.index, 0);
  const rightView = { start: 228.5, count: 12 };
  assert.equal(projectChartCrosshair({ x: 1_166, y: 322 }, plot, rightView, 240, prices)?.index, 239);
  assert.equal(projectChartCrosshair({ x: 1_167, y: 322 }, plot, rightView, 240, prices)?.index, null);
});

test("ignores pointer locations outside the plot or without a real candle center", () => {
  for (const point of [
    { x: 15, y: 100 }, { x: 1_217, y: 100 },
    { x: 100, y: 21 }, { x: 100, y: 623 },
  ]) {
    assert.equal(projectChartCrosshair(point, plot, viewport, 240, prices), null);
  }
  assert.equal(projectChartCrosshair({ x: 100, y: 100 }, plot, { start: 0.6, count: 0.3 }, 240, prices), null);
  assert.equal(projectChartCrosshair({ x: 100, y: 100 }, plot, { start: 300, count: 120 }, 240, prices), null);
  assert.equal(projectChartCrosshair({ x: 100, y: 100 }, plot, viewport, 0, prices), null);
});

test("rejects invalid dimensions, data counts, coordinates, and price ranges", () => {
  const point = { x: 100, y: 100 };
  for (const badPlot of [
    { ...plot, width: 0 }, { ...plot, height: -1 },
    { ...plot, left: Number.NaN }, { ...plot, top: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(projectChartCrosshair(point, badPlot, viewport, 240, prices), null);
  }
  for (const badViewport of [
    { start: Number.NaN, count: 120 }, { start: 0, count: 0 },
    { start: 0, count: -12 }, { start: 0, count: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(projectChartCrosshair(point, plot, badViewport, 240, prices), null);
  }
  for (const total of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.equal(projectChartCrosshair(point, plot, viewport, total, prices), null);
  }
  for (const range of [
    { low: 90, high: 90 }, { low: 150, high: 90 },
    { low: 0, high: Number.POSITIVE_INFINITY }, { low: Number.NaN, high: 150 },
    { low: -Number.MAX_VALUE, high: Number.MAX_VALUE },
  ]) {
    assert.equal(projectChartCrosshair(point, plot, viewport, 240, range), null);
  }
  assert.equal(projectChartCrosshair({ x: Number.NaN, y: 100 }, plot, viewport, 240, prices), null);
  assert.equal(projectChartCrosshair({ x: 100, y: Number.POSITIVE_INFINITY }, plot, viewport, 240, prices), null);
});
