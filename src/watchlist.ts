const STORAGE_KEY = "crypto-top.watchlist.v1";
const STORAGE_VERSION = 1;
const PRODUCT_ID_PATTERN = /^([A-Z0-9][A-Z0-9._-]{0,63})-USD$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const PRODUCTS_ENDPOINT = "https://api.exchange.coinbase.com/products";
const CURRENCIES_ENDPOINT = "https://api.exchange.coinbase.com/currencies";
const BITSTAMP_MARKETS_ENDPOINT = "https://www.bitstamp.net/api/v2/markets/";

export interface Product {
  id: string;
  symbol: string;
  name: string;
  krakenSymbol: string | null;
  bitstampSymbol: string | null;
  bitfinexSymbol: string | null;
  fixed: boolean;
}

export interface BackupSourceMappings {
  bitstamp: Map<string, string> | null;
  bitfinex: Map<string, string> | null;
}

export interface SearchableProduct {
  id: string;
  symbol: string;
  name: string;
}

export type FetchImplementation = (url: string, options: RequestInit) => Promise<unknown>;

type UnknownRecord = Record<string, unknown>;

interface BitfinexPairParts {
  base: string;
  quote: string;
  pair: string;
}

interface ResponseLike {
  ok: unknown;
  status?: unknown;
  json(): unknown;
}

export const MAX_PRODUCTS = 8;

export const DEFAULT_PRODUCTS: readonly Readonly<Product>[] = Object.freeze([
  Object.freeze({
    id: "BTC-USD",
    symbol: "BTC",
    name: "Bitcoin",
    krakenSymbol: "BTC/USD",
    bitstampSymbol: "btcusd",
    bitfinexSymbol: "tBTCUSD",
    fixed: true,
  }),
  Object.freeze({
    id: "ETH-USD",
    symbol: "ETH",
    name: "Ethereum",
    krakenSymbol: "ETH/USD",
    bitstampSymbol: "ethusd",
    bitfinexSymbol: "tETHUSD",
    fixed: true,
  }),
]);

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object";
}

function cloneProduct(product: Readonly<Product>): Product {
  return {
    id: product.id,
    symbol: product.symbol,
    name: product.name,
    krakenSymbol: product.krakenSymbol,
    bitstampSymbol: product.bitstampSymbol,
    bitfinexSymbol: product.bitfinexSymbol,
    fixed: product.fixed,
  };
}

function defaultProducts(): Product[] {
  return DEFAULT_PRODUCTS.map(cloneProduct);
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

function fixedProduct(id: string): Product | null {
  for (const product of DEFAULT_PRODUCTS) {
    if (product.id === id) return cloneProduct(product);
  }
  return null;
}

export function inferProduct(productId: unknown): Product | null {
  if (typeof productId !== "string") return null;
  const id = productId.trim().toUpperCase();
  const match = PRODUCT_ID_PATTERN.exec(id);
  if (!match) return null;

  const fixed = fixedProduct(id);
  if (fixed) return fixed;

  const symbol = match[1];
  return {
    id,
    symbol,
    name: symbol,
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    fixed: false,
  };
}

function storedBitstampSymbol(value: unknown, productSymbol: unknown): string | null {
  if (typeof value !== "string") return null;
  const marketSymbol = value.trim().toLowerCase();
  if (
    typeof productSymbol !== "string"
    || !/^[A-Z0-9]+$/.test(productSymbol)
    || !/^[a-z0-9]{2,80}$/.test(marketSymbol)
    || !marketSymbol.endsWith("usd")
  ) return null;
  const base = marketSymbol.slice(0, -3);
  return base.toUpperCase() === productSymbol ? marketSymbol : null;
}

function bitfinexPairParts(value: unknown): BitfinexPairParts | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const pair = (trimmed.startsWith("t") ? trimmed.slice(1) : trimmed).toUpperCase();
  if (!/^[A-Z0-9._-]+(?::[A-Z0-9._-]+)?$/.test(pair)) return null;
  if (pair.includes(":")) {
    const parts = pair.split(":");
    return parts.length === 2 && parts[0] && parts[1]
      ? { base: parts[0], quote: parts[1], pair }
      : null;
  }
  if (!/^[A-Z0-9]+$/.test(pair) || !pair.endsWith("USD") || pair.length <= 3) return null;
  return { base: pair.slice(0, -3), quote: "USD", pair };
}

function storedBitfinexSymbol(value: unknown, productSymbol: unknown): string | null {
  const parts = bitfinexPairParts(value);
  if (!parts || parts.quote !== "USD") return null;
  return typeof productSymbol === "string" && parts.base === productSymbol.toUpperCase()
    ? `t${parts.pair}`
    : null;
}

function normalizeProduct(value: unknown): Product | null {
  if (!isRecord(value)) return null;
  const inferred = inferProduct(value.id);
  if (!inferred) return null;
  if (inferred.fixed) return inferred;
  inferred.name = cleanText(value.name, inferred.symbol);
  inferred.bitstampSymbol = storedBitstampSymbol(value.bitstampSymbol, inferred.symbol);
  inferred.bitfinexSymbol = storedBitfinexSymbol(value.bitfinexSymbol, inferred.symbol);
  return inferred;
}

function normalizeWatchlist(products: unknown): Product[] {
  const normalized = defaultProducts();
  const seen = new Set(normalized.map((product) => product.id));
  if (!Array.isArray(products)) return normalized;

  for (const value of products) {
    if (normalized.length >= MAX_PRODUCTS) break;
    const product = normalizeProduct(value);
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    normalized.push(product);
  }
  return normalized;
}

function resolveStorage(storage?: unknown): unknown {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadWatchlist(storage?: unknown): Product[] {
  const target = resolveStorage(storage);
  const candidate = target as { getItem?: unknown } | null | undefined;
  if (!candidate || typeof candidate.getItem !== "function") return defaultProducts();

  try {
    const raw = candidate.getItem(STORAGE_KEY);
    if (typeof raw !== "string") return defaultProducts();
    const payload: unknown = JSON.parse(raw);
    if (
      !isRecord(payload)
      || payload.version !== STORAGE_VERSION
      || !Array.isArray(payload.products)
    ) return defaultProducts();
    return normalizeWatchlist(payload.products);
  } catch {
    return defaultProducts();
  }
}

export function saveWatchlist(products: unknown, storage?: unknown): Product[] {
  const normalized = normalizeWatchlist(products);
  const target = resolveStorage(storage);
  const candidate = target as { setItem?: unknown } | null | undefined;
  if (!candidate || typeof candidate.setItem !== "function") return normalized;

  try {
    candidate.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      products: normalized,
    }));
  } catch {
    // Persistence can be unavailable in private or restricted WebViews.
  }
  return normalized;
}

function currencyNames(currenciesPayload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (!Array.isArray(currenciesPayload)) return names;

  for (const currency of currenciesPayload) {
    if (!isRecord(currency)) continue;
    if (typeof currency.id !== "string" || !SYMBOL_PATTERN.test(currency.id)) continue;
    names.set(currency.id, cleanText(currency.name, currency.id));
  }
  return names;
}

function compareProducts(left: SearchableProduct, right: SearchableProduct): number {
  if (left.symbol < right.symbol) return -1;
  if (left.symbol > right.symbol) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function parseProductCatalog(productsPayload: unknown, currenciesPayload: unknown): Product[] {
  if (!Array.isArray(productsPayload)) return [];
  const names = currencyNames(currenciesPayload);
  const seen = new Set<string>();
  const catalog: Product[] = [];

  for (const product of productsPayload) {
    if (!isRecord(product)) continue;
    if (
      product.status !== "online"
      || product.quote_currency !== "USD"
      || product.trading_disabled
      || product.cancel_only
      || product.post_only
    ) continue;

    const inferred = inferProduct(product.id);
    if (!inferred || product.id !== inferred.id) continue;
    if (product.base_currency !== inferred.symbol || seen.has(inferred.id)) continue;

    inferred.name = names.get(inferred.symbol) || inferred.symbol;
    seen.add(inferred.id);
    catalog.push(inferred);
  }

  return catalog.sort(compareProducts);
}

async function responseJson(response: unknown, label: string): Promise<unknown> {
  const candidate = response as ResponseLike | null | undefined;
  if (!candidate || candidate.ok !== true) {
    const status = candidate && Number.isFinite(candidate.status as number)
      ? ` ${candidate.status}`
      : "";
    throw new Error(`${label} request failed${status}`);
  }
  return candidate.json();
}

export async function fetchProductCatalog(
  fetchImpl?: FetchImplementation | null,
): Promise<Product[]> {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const options: RequestInit = {
    cache: "no-store",
    headers: { Accept: "application/json" },
  };
  const responses = await Promise.all([
    fetchImpl(PRODUCTS_ENDPOINT, options),
    fetchImpl(CURRENCIES_ENDPOINT, options),
  ]);
  const payloads = await Promise.all([
    responseJson(responses[0], "Coinbase products"),
    responseJson(responses[1], "Coinbase currencies"),
  ]);
  if (!Array.isArray(payloads[0]) || !Array.isArray(payloads[1])) {
    throw new Error("Coinbase catalog response is invalid");
  }
  const catalog = parseProductCatalog(payloads[0], payloads[1]);
  if (catalog.length === 0) throw new Error("Coinbase catalog is empty");
  return catalog;
}

export function parseBitstampMarkets(payload: unknown): Map<string, string> | null {
  if (!Array.isArray(payload)) return null;
  const mappings = new Map<string, string>();
  for (const market of payload) {
    if (!isRecord(market)) continue;
    if (
      market.counter_currency !== "USD"
      || market.market_type !== "SPOT"
      || market.trading !== "Enabled"
      || typeof market.base_currency !== "string"
      || !SYMBOL_PATTERN.test(market.base_currency)
    ) continue;
    const symbol = storedBitstampSymbol(market.market_symbol, market.base_currency);
    if (!symbol || mappings.has(market.base_currency)) continue;
    mappings.set(market.base_currency, symbol);
  }
  return mappings;
}

export function parseBitfinexPairs(payload: unknown): Map<string, string> | null {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const mappings = new Map<string, string>();
  for (const value of payload[0]) {
    const parts = bitfinexPairParts(value);
    if (
      !parts
      || parts.quote !== "USD"
      || !SYMBOL_PATTERN.test(parts.base)
      || parts.base.startsWith("TEST")
      || mappings.has(parts.base)
    ) continue;
    mappings.set(parts.base, `t${parts.pair}`);
  }
  return mappings;
}

export function applyBackupSourceMappings(
  products: readonly Product[],
  sourceMappings: Partial<BackupSourceMappings> | null | undefined,
): Product[];
export function applyBackupSourceMappings<T>(
  products: readonly T[],
  sourceMappings: unknown,
): Array<T | Product>;
export function applyBackupSourceMappings(products: unknown, sourceMappings: unknown): unknown[];
export function applyBackupSourceMappings(products: unknown, sourceMappings: unknown): unknown[] {
  const mappingContainer = sourceMappings as {
    bitstamp?: unknown;
    bitfinex?: unknown;
  } | null | undefined;
  const bitstamp = mappingContainer && mappingContainer.bitstamp;
  const bitfinex = mappingContainer && mappingContainer.bitfinex;
  return (Array.isArray(products) ? products : []).map((raw) => {
    const product = normalizeProduct(raw);
    if (!product) return raw;
    if (bitstamp instanceof Map) {
      product.bitstampSymbol = bitstamp.get(product.symbol) || null;
    }
    if (bitfinex instanceof Map) {
      product.bitfinexSymbol = bitfinex.get(product.symbol) || null;
    }
    return product;
  });
}

async function fetchOptionalDirectory(
  fetchImpl: FetchImplementation,
  url: string,
  label: string,
  parser: (payload: unknown) => Map<string, string> | null,
  options: RequestInit,
): Promise<Map<string, string> | null> {
  try {
    const payload = await responseJson(await fetchImpl(url, options), label);
    const parsed = parser(payload);
    return parsed instanceof Map && parsed.size > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchBackupSourceMappings(
  fetchImpl?: FetchImplementation | null,
): Promise<BackupSourceMappings> {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const options: RequestInit = {
    cache: "no-store",
    headers: { Accept: "application/json" },
  };
  const bitstamp = await fetchOptionalDirectory(
    fetchImpl,
    BITSTAMP_MARKETS_ENDPOINT,
    "Bitstamp markets",
    parseBitstampMarkets,
    options,
  );
  // Bitfinex's public REST configuration endpoint does not allow browser CORS.
  // BTC/ETH therefore use verified built-in symbols, while custom-product
  // mappings remain disabled unless a future browser-safe official directory
  // becomes available.
  return { bitstamp, bitfinex: null };
}

function searchRank(product: SearchableProduct, query: string): number | null {
  if (!query) return 0;
  const symbol = product.symbol.toLowerCase();
  const id = product.id.toLowerCase();
  const name = product.name.toLowerCase();
  if (symbol === query || id === query) return 0;
  if (symbol.startsWith(query)) return 1;
  if (id.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (symbol.includes(query)) return 4;
  if (id.includes(query)) return 5;
  if (name.includes(query)) return 6;
  return null;
}

function isSearchableProduct(value: unknown): value is SearchableProduct {
  const candidate = value as Partial<SearchableProduct> | null | undefined;
  return !!candidate
    && typeof candidate.id === "string"
    && typeof candidate.symbol === "string"
    && typeof candidate.name === "string";
}

export function searchProducts<T extends SearchableProduct>(
  catalog: readonly T[],
  query: unknown,
  limit?: unknown,
): T[];
export function searchProducts(
  catalog: unknown,
  query: unknown,
  limit?: unknown,
): SearchableProduct[];
export function searchProducts(
  catalog: unknown,
  query: unknown,
  limit?: unknown,
): SearchableProduct[] {
  if (!Array.isArray(catalog)) return [];
  const normalizedQuery = query == null ? "" : String(query).trim().toLowerCase();
  const requestedLimit = limit == null ? catalog.length : Number(limit);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const resultLimit = Math.floor(requestedLimit);

  return catalog
    .filter(isSearchableProduct)
    .map((product) => ({ product, rank: searchRank(product, normalizedQuery) }))
    .filter((entry): entry is { product: SearchableProduct; rank: number } => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || compareProducts(left.product, right.product))
    .slice(0, resultLimit)
    .map((entry) => entry.product);
}
