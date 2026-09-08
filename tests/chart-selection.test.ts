import test from "node:test";
import assert from "node:assert/strict";

import {
  createChartSelection,
  parseChartSelection,
  serializeChartSelection,
} from "../src/chart-selection.ts";
import type { Product } from "../src/watchlist.ts";

const bitcoin: Product = {
  id: "BTC-USD",
  symbol: "BTC",
  name: "  Bit\u0000coin\n  Core  ",
  krakenSymbol: "BTC/USD",
  bitstampSymbol: "btcusd",
  bitfinexSymbol: "tBTCUSD",
  fixed: true,
};

const applePerpetual: Product = {
  id: "AAPL-USDT-PERP",
  symbol: "AAPL.P",
  name: " Apple\u202e   Inc. ",
  krakenSymbol: null,
  bitstampSymbol: null,
  bitfinexSymbol: null,
  bybitSymbol: "AAPLUSDT",
  gateSymbol: "AAPL_USDT",
  quoteCurrency: "USDT",
  marketType: "perpetual",
  assetClass: "equity",
  fixed: false,
};

test("creates a canonical versioned spot selection and cleans remote text", () => {
  const selection = createChartSelection(bitcoin, "kraken");

  assert.deepEqual(selection, {
    version: 1,
    product: {
      ...bitcoin,
      name: "Bit coin Core",
      quoteCurrency: "USD",
      marketType: "spot",
      assetClass: "crypto",
    },
    marketSource: "kraken",
  });
  assert.deepEqual(parseChartSelection(serializeChartSelection(selection)), selection);
});

test("round-trips exact perpetual mappings while removing bidi controls from names", () => {
  const selection = createChartSelection(applePerpetual, "bybit");
  const parsed = parseChartSelection(serializeChartSelection(selection));

  assert.ok(parsed);
  assert.equal(parsed.product.name, "Apple Inc.");
  assert.equal(parsed.product.bybitSymbol, "AAPLUSDT");
  assert.equal(parsed.product.gateSymbol, "AAPL_USDT");
  assert.equal(parsed.marketSource, "bybit");
});

test("accepts null or every known live market source", () => {
  for (const source of [null, "coinbase", "kraken", "bitstamp", "bitfinex", "bybit", "gate"] as const) {
    const selection = createChartSelection(bitcoin, source);
    assert.equal(parseChartSelection(serializeChartSelection(selection))?.marketSource, source);
  }
});

test("strictly rejects malformed envelopes, ids, product metadata, and sources", () => {
  const valid = JSON.parse(serializeChartSelection(createChartSelection(applePerpetual, "gate"))) as {
    version: number;
    product: Record<string, unknown>;
    marketSource: unknown;
    extra?: unknown;
  };

  assert.equal(parseChartSelection("not json"), null);
  assert.equal(parseChartSelection(null), null);
  assert.equal(parseChartSelection({}), null);

  assert.equal(parseChartSelection({ ...valid, version: 2 }), null);
  assert.equal(parseChartSelection({ ...valid, extra: true }), null);
  assert.equal(parseChartSelection({ ...valid, marketSource: "binance" }), null);
  assert.equal(parseChartSelection({ ...valid, product: { ...valid.product, id: "AAPL-USDT" } }), null);
  assert.equal(parseChartSelection({ ...valid, product: { ...valid.product, symbol: "AAPL" } }), null);
  assert.equal(
    parseChartSelection({ ...valid, product: { ...valid.product, bybitSymbol: "TSLAUSDT" } }),
    null,
  );
  assert.equal(
    parseChartSelection({ ...valid, product: { ...valid.product, gateSymbol: "TSLA_USDT" } }),
    null,
  );
  assert.equal(
    parseChartSelection({
      ...valid,
      product: { ...valid.product, bybitSymbol: null, gateSymbol: null },
    }),
    null,
  );
  assert.equal(
    parseChartSelection({ ...valid, product: { ...valid.product, unexpectedRemoteField: true } }),
    null,
  );
});

test("create and serialization reject values that only satisfy the TypeScript shape", () => {
  assert.throws(
    () => createChartSelection({ ...applePerpetual, bybitSymbol: "MSFTUSDT" }, "bybit"),
    /Invalid chart product/,
  );
  assert.throws(
    () => serializeChartSelection({
      version: 1,
      product: applePerpetual,
      marketSource: "unsupported" as "coinbase",
    }),
    /Invalid chart market source/,
  );
});
