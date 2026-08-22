import test from "node:test";
import assert from "node:assert/strict";

import { formatUsdPrice } from "../src/price-format.js";

test("formats large prices compactly with grouping and cents", () => {
  assert.equal(formatUsdPrice(999999.999), "1,000,000.00");
  assert.equal(formatUsdPrice(12345.6), "12,345.60");
});

test("keeps useful precision for inexpensive coins", () => {
  assert.equal(formatUsdPrice(12.34567), "12.3457");
  assert.equal(formatUsdPrice(0.123456), "0.1235");
  assert.equal(formatUsdPrice(0.00123456), "0.001235");
  assert.equal(formatUsdPrice(0.00000123), "0.00000123");
  assert.equal(formatUsdPrice(0.00000000123), "1.23e-9");
});

test("rejects unavailable or invalid prices", () => {
  assert.equal(formatUsdPrice(null), "—");
  assert.equal(formatUsdPrice(0), "—");
  assert.equal(formatUsdPrice(-1), "—");
  assert.equal(formatUsdPrice(Number.NaN), "—");
});
