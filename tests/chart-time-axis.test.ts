import test from "node:test";
import assert from "node:assert/strict";

import { layoutChartTimeAxis } from "../src/chart-time-axis.ts";

const plot = { left: 16, width: 1_200 };
const measureDate = (): number => 100;

test("an unconfirmed loaded edge gets an ordinary date instead of an origin flag", () => {
  const layout = layoutChartTimeAxis({ start: -119, count: 120 }, 240, plot, measureDate, null);
  assert.deepEqual(layout, {
    ticks: [{ index: 0, x: 1_166, width: 100 }],
    startMarker: null,
  });
  const pageEdge = layoutChartTimeAxis({ start: 0, count: 120 }, 240, plot, measureDate, null);
  assert.equal(pageEdge.startMarker, null);
  assert.equal(pageEdge.ticks[0]?.index, 0);
});

test("latest-only pan leaves the future blank and retains its real date", () => {
  const layout = layoutChartTimeAxis({ start: 239, count: 120 }, 240, plot, measureDate, 220);
  assert.deepEqual(layout, {
    ticks: [{ index: 239, x: 66, width: 100 }],
    startMarker: null,
  });
});

test("oldest-only pan anchors the start marker to its candle at the right edge", () => {
  const layout = layoutChartTimeAxis({ start: -119, count: 120 }, 240, plot, measureDate, 220);
  assert.deepEqual(layout, {
    ticks: [],
    startMarker: { x: 1_211, left: 996, width: 220 },
  });
});

test("centers exactly on either plot edge still have an axis annotation", () => {
  assert.deepEqual(
    layoutChartTimeAxis({ start: 239.5, count: 120 }, 240, plot, measureDate, 220),
    { ticks: [{ index: 239, x: 66, width: 100 }], startMarker: null },
  );
  assert.deepEqual(
    layoutChartTimeAxis({ start: -119.5, count: 120 }, 240, plot, measureDate, 220),
    { ticks: [], startMarker: { x: 1_216, left: 996, width: 220 } },
  );
});

test("partly blank ranges use only visible real candle indices", () => {
  const older = layoutChartTimeAxis({ start: -60, count: 120 }, 240, plot, measureDate, 220);
  assert.deepEqual(older.startMarker, { x: 621, left: 511, width: 220 });
  assert.ok(older.ticks.length >= 2);
  assert.ok(older.ticks.every((tick) => tick.index >= 0 && tick.index < 60));

  const newer = layoutChartTimeAxis({ start: 180, count: 120 }, 240, plot, measureDate, 220);
  assert.equal(newer.startMarker, null);
  assert.ok(newer.ticks.length >= 2);
  assert.ok(newer.ticks.every((tick) => tick.index >= 180 && tick.index <= 239));
  assert.ok(newer.ticks.every((tick) => tick.x <= 611));
});

test("fractional pan excludes dates whose candle centers are clipped", () => {
  const layout = layoutChartTimeAxis({ start: 10.75, count: 12.5 }, 100, plot, measureDate, 220);
  assert.deepEqual(layout.ticks.map((tick) => tick.index), [11, 14, 17, 19, 22]);
  assert.equal(layout.startMarker, null);
  assert.equal(layout.ticks[0]?.x, 88);
  assert.equal(layout.ticks[4]?.x, 1_144);
});

test("compact layout prioritizes the marker and prevents overlapping date labels", () => {
  const compactPlot = { left: 10, width: 300 };
  const layout = layoutChartTimeAxis({ start: 0, count: 120 }, 240, compactPlot, measureDate, 150);
  assert.deepEqual(layout.startMarker, { x: 11.25, left: 10, width: 150 });
  assert.equal(layout.ticks.length, 1);
  assert.equal(layout.ticks[0]?.index, 89);
  assert.ok((layout.ticks[0]?.x ?? 0) - 50 >= 172);

  const dates = layoutChartTimeAxis({ start: 120, count: 120 }, 240, compactPlot, measureDate, 150);
  assert.ok(dates.ticks.length > 0 && dates.ticks.length <= 3);
  for (let index = 1; index < dates.ticks.length; index += 1) {
    assert.ok(dates.ticks[index]!.x - dates.ticks[index - 1]!.x >= 112);
  }
});

test("marker rectangle stays in a narrow plot while its anchor remains exact", () => {
  const layout = layoutChartTimeAxis({ start: -11, count: 12 }, 24, { left: 16, width: 80 }, measureDate, 220);
  assert.ok(layout.startMarker);
  assert.equal(layout.startMarker.left, 16);
  assert.equal(layout.startMarker.width, 80);
  assert.equal(layout.startMarker.x, 16 + 11.5 / 12 * 80);
  assert.deepEqual(layout.ticks, []);
});

test("prepending history moves the marker to the new oldest candle without moving the old one", () => {
  const before = layoutChartTimeAxis({ start: -60, count: 120 }, 240, plot, measureDate, 220);
  const after = layoutChartTimeAxis({ start: -59, count: 120 }, 241, plot, measureDate, 220);
  assert.equal(before.startMarker!.x - after.startMarker!.x, 10);
  const fullyBuffered = layoutChartTimeAxis({ start: 180, count: 120 }, 480, plot, measureDate, 220);
  assert.equal(fullyBuffered.startMarker, null);
  assert.ok(fullyBuffered.ticks.every((tick) => tick.index >= 180 && tick.index <= 299));
});

test("returns no manufactured labels when no candle center is visible", () => {
  for (const viewport of [
    { start: 240, count: 120 }, { start: -121, count: 120 }, { start: 0.6, count: 0.3 },
  ]) {
    assert.deepEqual(layoutChartTimeAxis(viewport, 240, plot, measureDate, 220), {
      ticks: [], startMarker: null,
    });
  }
});

test("invalid dimensions and ranges are empty and invalid date measurements are skipped", () => {
  const viewport = { start: 120, count: 120 };
  const empty = { ticks: [], startMarker: null };
  for (const total of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.deepEqual(layoutChartTimeAxis(viewport, total, plot, measureDate, 220), empty);
  }
  for (const invalidViewport of [
    { start: Number.NaN, count: 120 }, { start: Number.POSITIVE_INFINITY, count: 120 },
    { start: 120, count: 0 }, { start: 120, count: -1 }, { start: 120, count: Number.POSITIVE_INFINITY },
  ]) {
    assert.deepEqual(layoutChartTimeAxis(invalidViewport, 240, plot, measureDate, 220), empty);
  }
  for (const invalidPlot of [
    { left: Number.NaN, width: 1_200 }, { left: 16, width: 0 },
    { left: 16, width: -1 }, { left: 16, width: Number.POSITIVE_INFINITY },
  ]) {
    assert.deepEqual(layoutChartTimeAxis(viewport, 240, invalidPlot, measureDate, 220), empty);
  }
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(layoutChartTimeAxis(viewport, 240, plot, measureDate, width), empty);
  }
  for (const width of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1_201]) {
    assert.deepEqual(layoutChartTimeAxis(viewport, 240, plot, () => width, 220), empty);
  }
});
