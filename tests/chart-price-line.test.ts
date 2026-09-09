import test from "node:test";
import assert from "node:assert/strict";
import { projectChartPriceLine } from "../src/chart-price-line.ts";

const plot = { left: 16, top: 22, width: 1_200, height: 600 };
const range = { low: 100, high: 200 };

test("current price line and axis tag share the candle scale and exact endpoints", () => {
  assert.deepEqual(projectChartPriceLine(150, plot, range), { lineY: 322, labelY: 322, edge: null });
  assert.deepEqual(projectChartPriceLine(200, plot, range), { lineY: 22, labelY: 22, edge: null });
  assert.deepEqual(projectChartPriceLine(100, plot, range), { lineY: 622, labelY: 622, edge: null });
});

test("historical scales keep an off-scale current value at the edge without a false horizontal line", () => {
  assert.deepEqual(projectChartPriceLine(250, plot, range), { lineY: null, labelY: 22, edge: "above" });
  assert.deepEqual(projectChartPriceLine(50, plot, range), { lineY: null, labelY: 622, edge: "below" });
});

test("price projection follows resized and zoomed scales", () => {
  assert.deepEqual(projectChartPriceLine(150, { ...plot, height: 200 }, range), {
    lineY: 122, labelY: 122, edge: null,
  });
  assert.deepEqual(projectChartPriceLine(150, plot, { low: 125, high: 175 }), {
    lineY: 322, labelY: 322, edge: null,
  });
});

test("small-price markets retain precision without rounding the line to an axis tick", () => {
  const result = projectChartPriceLine(0.000000015, plot, { low: 0.00000001, high: 0.00000002 });
  assert.ok(result && result.lineY !== null);
  assert.ok(Math.abs(result.lineY - 322) < 1e-8);
});

test("invalid quotes and scales do not manufacture a current price line", () => {
  for (const value of [0, -1, NaN, Infinity]) assert.equal(projectChartPriceLine(value, plot, range), null);
  assert.equal(projectChartPriceLine(150, { ...plot, height: 0 }, range), null);
  assert.equal(projectChartPriceLine(150, { ...plot, width: NaN }, range), null);
  assert.equal(projectChartPriceLine(150, plot, { low: 200, high: 200 }), null);
  assert.equal(projectChartPriceLine(150, plot, { low: 200, high: 100 }), null);
});
