import test from "node:test";
import assert from "node:assert/strict";

import { chartPriceTicks } from "../src/chart-price-axis.ts";

function assertVisibleTicks(ticks: readonly number[], low: number, high: number): void {
  assert.ok(ticks.length <= 12, "price labels stay bounded on arbitrarily tall plots");
  for (const [index, price] of ticks.entries()) {
    assert.ok(Number.isFinite(price) && price > 0 && price >= low && price <= high);
    if (index > 0) assert.ok(price < ticks[index - 1], "ticks are unique and descend");
  }
}

test("BTC grid uses readable round prices without expanding the visible scale", () => {
  const ticks = chartPriceTicks(63_240, 64_860, 480);
  assert.deepEqual(ticks, [64_750, 64_500, 64_250, 64_000, 63_750, 63_500, 63_250]);
  assertVisibleTicks(ticks, 63_240, 64_860);
});

test("a taller chart adds grid rows while retaining readable spacing", () => {
  const low = 60_000;
  const high = 66_000;
  const short = chartPriceTicks(low, high, 180);
  const tall = chartPriceTicks(low, high, 640);
  assert.ok(tall.length > short.length);
  for (const [ticks, height] of [[short, 180], [tall, 640]] as const) {
    assertVisibleTicks(ticks, low, high);
    assert.ok((ticks[0] - ticks[1]) / (high - low) * height >= 60);
  }
});

test("fractional boundary prices remain included without binary rounding noise", () => {
  assert.deepEqual(chartPriceTicks(0.1, 0.3, 192), [0.3, 0.2, 0.1]);
  assert.deepEqual(chartPriceTicks(0, 1, 256), [1, 0.75, 0.5, 0.25]);
});

test("tiny crypto prices retain distinct decimal ticks below 1e-8", () => {
  const ticks = chartPriceTicks(8e-12, 1.35e-11, 400);
  assert.deepEqual(ticks, [1.3e-11, 1.2e-11, 1.1e-11, 1e-11, 9e-12, 8e-12]);
  assertVisibleTicks(ticks, 8e-12, 1.35e-11);
});

test("positive labels keep full-scale spacing when padding extends below zero", () => {
  assert.deepEqual(chartPriceTicks(-100, 100, 256), [100, 50]);
  assert.deepEqual(chartPriceTicks(-100, 0, 256), []);
});

test("flat positive ranges provide one usable price and invalid inputs provide none", () => {
  assert.deepEqual(chartPriceTicks(104, 104, 300), [104]);
  for (const [low, high, height] of [
    [2, 1, 300], [0, 0, 300], [-2, -1, 300],
    [1, 2, 0], [1, 2, -100], [1, 2, Number.NaN], [1, 2, Infinity],
    [Number.NaN, 2, 300], [1, Number.NaN, 300], [-Infinity, 2, 300], [1, Infinity, 300],
  ]) assert.deepEqual(chartPriceTicks(low, high, height), []);
});

test("finite extreme and near-flat prices cannot generate infinite or duplicate labels", () => {
  for (const [low, high, height] of [
    [0, Number.MAX_VALUE, 1],
    [0, Number.MAX_VALUE, 1000],
    [-Number.MAX_VALUE, Number.MAX_VALUE, 1000],
    [1e300, 1e300 + 1e285, 500],
    [Number.MAX_VALUE * (1 - 1e-14), Number.MAX_VALUE, 500],
    [Number.MIN_VALUE, 1e-322, 500],
    [Number.MIN_VALUE, Number.MIN_VALUE * 2, 500],
    [1, 2, Number.MAX_VALUE],
  ]) {
    const ticks = chartPriceTicks(low, high, height);
    assertVisibleTicks(ticks, low, high);
    assert.ok(ticks.length > 0, `finite positive range ${low}..${high} has usable labels`);
  }
});
