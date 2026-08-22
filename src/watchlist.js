const STORAGE_KEY = "crypto-top.watchlist.v1";
const STORAGE_VERSION = 1;
const PRODUCT_ID_PATTERN = /^([A-Z0-9][A-Z0-9._-]{0,63})-USD$/;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const PRODUCTS_ENDPOINT = "https://api.exchange.coinbase.com/products";
const CURRENCIES_ENDPOINT = "https://api.exchange.coinbase.com/currencies";
const BITSTAMP_MARKETS_ENDPOINT = "https://www.bitstamp.net/api/v2/markets/";

export const MAX_PRODUCTS = 8;

export const DEFAULT_PRODUCTS = Object.freeze([
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

function cloneProduct(product) {
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

function defaultProducts() {
  return DEFAULT_PRODUCTS.map(cloneProduct);
}

function cleanText(value, fallback) {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

function fixedProduct(id) {
  for (const product of DEFAULT_PRODUCTS) {
    if (product.id === id) return cloneProduct(product);
  }
  return null;
}

export function inferProduct(productId) {
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

function storedBitstampSymbol(value, productSymbol) {
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

function bitfinexPairParts(value) {
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

function storedBitfinexSymbol(value, productSymbol) {
  const parts = bitfinexPairParts(value);
  if (!parts || parts.quote !== "USD") return null;
  return typeof productSymbol === "string" && parts.base === productSymbol.toUpperCase()
    ? `t${parts.pair}`
    : null;
}

function normalizeProduct(value) {
  if (!value || typeof value !== "object") return null;
  const inferred = inferProduct(value.id);
  if (!inferred) return null;
  if (inferred.fixed) return inferred;
  inferred.name = cleanText(value.name, inferred.symbol);
  inferred.bitstampSymbol = storedBitstampSymbol(value.bitstampSymbol, inferred.symbol);
  inferred.bitfinexSymbol = storedBitfinexSymbol(value.bitfinexSymbol, inferred.symbol);
  return inferred;
}

function normalizeWatchlist(products) {
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

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadWatchlist(storage) {
  const target = resolveStorage(storage);
  if (!target || typeof target.getItem !== "function") return defaultProducts();

  try {
    const raw = target.getItem(STORAGE_KEY);
    if (typeof raw !== "string") return defaultProducts();
    const payload = JSON.parse(raw);
    if (
      !payload
      || typeof payload !== "object"
      || payload.version !== STORAGE_VERSION
      || !Array.isArray(payload.products)
    ) return defaultProducts();
    return normalizeWatchlist(payload.products);
  } catch {
    return defaultProducts();
  }
}

export function saveWatchlist(products, storage) {
  const normalized = normalizeWatchlist(products);
  const target = resolveStorage(storage);
  if (!target || typeof target.setItem !== "function") return normalized;

  try {
    target.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      products: normalized,
    }));
  } catch {
    // Persistence can be unavailable in private or restricted WebViews.
  }
  return normalized;
}

function currencyNames(currenciesPayload) {
  const names = new Map();
  if (!Array.isArray(currenciesPayload)) return names;

  for (const currency of currenciesPayload) {
    if (!currency || typeof currency !== "object") continue;
    if (typeof currency.id !== "string" || !SYMBOL_PATTERN.test(currency.id)) continue;
    names.set(currency.id, cleanText(currency.name, currency.id));
  }
  return names;
}

function compareProducts(left, right) {
  if (left.symbol < right.symbol) return -1;
  if (left.symbol > right.symbol) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function parseProductCatalog(productsPayload, currenciesPayload) {
  if (!Array.isArray(productsPayload)) return [];
  const names = currencyNames(currenciesPayload);
  const seen = new Set();
  const catalog = [];

  for (const product of productsPayload) {
    if (!product || typeof product !== "object") continue;
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

async function responseJson(response, label) {
  if (!response || response.ok !== true) {
    const status = response && Number.isFinite(response.status) ? ` ${response.status}` : "";
    throw new Error(`${label} request failed${status}`);
  }
  return response.json();
}

export async function fetchProductCatalog(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const options = {
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

export function parseBitstampMarkets(payload) {
  if (!Array.isArray(payload)) return null;
  const mappings = new Map();
  for (const market of payload) {
    if (!market || typeof market !== "object") continue;
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

export function parseBitfinexPairs(payload) {
  if (!Array.isArray(payload) || !Array.isArray(payload[0])) return null;
  const mappings = new Map();
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

export function applyBackupSourceMappings(products, sourceMappings) {
  const bitstamp = sourceMappings && sourceMappings.bitstamp;
  const bitfinex = sourceMappings && sourceMappings.bitfinex;
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

async function fetchOptionalDirectory(fetchImpl, url, label, parser, options) {
  try {
    const payload = await responseJson(await fetchImpl(url, options), label);
    const parsed = parser(payload);
    return parsed instanceof Map && parsed.size > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export async function fetchBackupSourceMappings(fetchImpl) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const options = {
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

function searchRank(product, query) {
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

export function searchProducts(catalog, query, limit) {
  if (!Array.isArray(catalog)) return [];
  const normalizedQuery = query == null ? "" : String(query).trim().toLowerCase();
  const requestedLimit = limit == null ? catalog.length : Number(limit);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return [];
  const resultLimit = Math.floor(requestedLimit);

  return catalog
    .filter((product) => (
      product
      && typeof product.id === "string"
      && typeof product.symbol === "string"
      && typeof product.name === "string"
    ))
    .map((product) => ({ product, rank: searchRank(product, normalizedQuery) }))
    .filter((entry) => entry.rank !== null)
    .sort((left, right) => left.rank - right.rank || compareProducts(left.product, right.product))
    .slice(0, resultLimit)
    .map((entry) => entry.product);
}
