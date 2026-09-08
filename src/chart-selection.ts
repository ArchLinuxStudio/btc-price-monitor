import type { MarketSource } from "./price-feed.js";
import type { Product } from "./watchlist.js";

const SPOT_PRODUCT_ID_PATTERN = /^([A-Z0-9][A-Z0-9._-]{0,63})-USD$/;
const PERPETUAL_PRODUCT_ID_PATTERN = /^([A-Z0-9][A-Z0-9.]{0,39})-USDT-PERP$/;
const MARKET_SOURCES = new Set<MarketSource>([
  "coinbase",
  "kraken",
  "bitstamp",
  "bitfinex",
  "bybit",
  "gate",
]);
const PRODUCT_KEYS = new Set([
  "id",
  "symbol",
  "name",
  "krakenSymbol",
  "bitstampSymbol",
  "bitfinexSymbol",
  "bybitSymbol",
  "gateSymbol",
  "quoteCurrency",
  "marketType",
  "assetClass",
  "fixed",
]);

type UnknownRecord = Record<string, unknown>;

export interface ChartSelection {
  version: 1;
  product: Product;
  marketSource: MarketSource | null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function cleanRemoteText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

function exactNullableString(value: unknown, expected: string): string | null | undefined {
  if (value === null) return null;
  if (value === expected) return expected;
  return undefined;
}

function normalizeBitstampSymbol(value: unknown, ticker: string): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Z0-9]+$/.test(ticker)) return undefined;
  const expected = `${ticker.toLowerCase()}usd`;
  return value === expected ? expected : undefined;
}

function normalizeBitfinexSymbol(value: unknown, ticker: string): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const expected = `t${ticker}USD`;
  return value === expected ? expected : undefined;
}

function normalizeSpotProduct(value: UnknownRecord, id: string, ticker: string): Product | null {
  if (
    value.symbol !== ticker
    || typeof value.name !== "string"
    || typeof value.fixed !== "boolean"
    || value.fixed !== (id === "BTC-USD" || id === "ETH-USD")
  ) return null;

  const krakenSymbol = exactNullableString(value.krakenSymbol, `${ticker}/USD`);
  const bitstampSymbol = normalizeBitstampSymbol(value.bitstampSymbol, ticker);
  const bitfinexSymbol = normalizeBitfinexSymbol(value.bitfinexSymbol, ticker);
  if (
    krakenSymbol === undefined
    || bitstampSymbol === undefined
    || bitfinexSymbol === undefined
  ) return null;
  if (value.bybitSymbol !== undefined || value.gateSymbol !== undefined) return null;
  if (value.quoteCurrency !== undefined && value.quoteCurrency !== "USD") return null;
  if (value.marketType !== undefined && value.marketType !== "spot") return null;
  if (value.assetClass !== undefined && value.assetClass !== "crypto") return null;

  return {
    id,
    symbol: ticker,
    name: cleanRemoteText(value.name, ticker),
    krakenSymbol,
    bitstampSymbol,
    bitfinexSymbol,
    quoteCurrency: "USD",
    marketType: "spot",
    assetClass: "crypto",
    fixed: value.fixed,
  };
}

function normalizePerpetualProduct(value: UnknownRecord, id: string, ticker: string): Product | null {
  if (
    value.symbol !== `${ticker}.P`
    || typeof value.name !== "string"
    || value.fixed !== false
    || value.krakenSymbol !== null
    || value.bitstampSymbol !== null
    || value.bitfinexSymbol !== null
    || value.quoteCurrency !== "USDT"
    || value.marketType !== "perpetual"
    || value.assetClass !== "equity"
  ) return null;

  const bybitSymbol = exactNullableString(value.bybitSymbol, `${ticker}USDT`);
  const gateSymbol = exactNullableString(value.gateSymbol, `${ticker}_USDT`);
  if (
    bybitSymbol === undefined
    || gateSymbol === undefined
    || (bybitSymbol === null && gateSymbol === null)
  ) return null;

  return {
    id,
    symbol: `${ticker}.P`,
    name: cleanRemoteText(value.name, ticker),
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol,
    gateSymbol,
    quoteCurrency: "USDT",
    marketType: "perpetual",
    assetClass: "equity",
    fixed: false,
  };
}

function normalizeProduct(value: unknown): Product | null {
  if (!isRecord(value) || !hasOnlyKeys(value, PRODUCT_KEYS) || typeof value.id !== "string") {
    return null;
  }

  const spotMatch = SPOT_PRODUCT_ID_PATTERN.exec(value.id);
  if (spotMatch) return normalizeSpotProduct(value, value.id, spotMatch[1]);

  const perpetualMatch = PERPETUAL_PRODUCT_ID_PATTERN.exec(value.id);
  if (perpetualMatch) return normalizePerpetualProduct(value, value.id, perpetualMatch[1]);
  return null;
}

function isMarketSource(value: unknown): value is MarketSource {
  return typeof value === "string" && MARKET_SOURCES.has(value as MarketSource);
}

function parseSelectionValue(value: unknown): UnknownRecord | null {
  if (typeof value !== "string") return isRecord(value) ? value : null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createChartSelection(
  product: Product,
  marketSource: MarketSource | null,
): ChartSelection {
  const normalizedProduct = normalizeProduct(product);
  if (!normalizedProduct) throw new TypeError("Invalid chart product");
  if (marketSource !== null && !isMarketSource(marketSource)) {
    throw new TypeError("Invalid chart market source");
  }
  return { version: 1, product: normalizedProduct, marketSource };
}

export function serializeChartSelection(selection: ChartSelection): string {
  const normalized = createChartSelection(selection.product, selection.marketSource);
  return JSON.stringify(normalized);
}

export function parseChartSelection(value: unknown): ChartSelection | null {
  const parsed = parseSelectionValue(value);
  if (
    !parsed
    || parsed.version !== 1
    || Object.keys(parsed).length !== 3
    || !("product" in parsed)
    || !("marketSource" in parsed)
  ) return null;

  const product = normalizeProduct(parsed.product);
  const marketSource = parsed.marketSource;
  if (!product || (marketSource !== null && !isMarketSource(marketSource))) return null;
  return { version: 1, product, marketSource };
}
