import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRODUCTS,
  MAX_PRODUCTS,
  applyBackupSourceMappings,
  fetchBackupSourceMappings,
  fetchProductCatalog,
  inferProduct,
  loadWatchlist,
  parseBitfinexPairs,
  parseBitstampMarkets,
  parseProductCatalog,
  saveWatchlist,
  searchProducts,
} from "../src/watchlist.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function product(id, overrides = {}) {
  const symbol = id.replace(/-USD$/, "");
  return {
    id,
    base_currency: symbol,
    quote_currency: "USD",
    status: "online",
    trading_disabled: false,
    cancel_only: false,
    post_only: false,
    ...overrides,
  };
}

test("defines immutable BTC and ETH defaults and an eight-product cap", () => {
  assert.equal(MAX_PRODUCTS, 8);
  assert.deepEqual(DEFAULT_PRODUCTS, [
    {
      id: "BTC-USD",
      symbol: "BTC",
      name: "Bitcoin",
      krakenSymbol: "BTC/USD",
      bitstampSymbol: "btcusd",
      bitfinexSymbol: "tBTCUSD",
      fixed: true,
    },
    {
      id: "ETH-USD",
      symbol: "ETH",
      name: "Ethereum",
      krakenSymbol: "ETH/USD",
      bitstampSymbol: "ethusd",
      bitfinexSymbol: "tETHUSD",
      fixed: true,
    },
  ]);
  assert.equal(Object.isFrozen(DEFAULT_PRODUCTS), true);
  assert.equal(Object.isFrozen(DEFAULT_PRODUCTS[0]), true);
});

test("infers normalized USD product models without accepting another quote currency", () => {
  assert.deepEqual(inferProduct(" sol-usd "), {
    id: "SOL-USD",
    symbol: "SOL",
    name: "SOL",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    fixed: false,
  });
  assert.deepEqual(inferProduct("btc-usd"), DEFAULT_PRODUCTS[0]);
  assert.equal(inferProduct("SOL-USDT"), null);
  assert.equal(inferProduct("SOL/USD"), null);
  assert.equal(inferProduct("-USD"), null);
  assert.equal(inferProduct(null), null);
});

test("save and load keep fixed defaults first, deduplicate, and cap custom products at six", () => {
  const storage = memoryStorage();
  const input = [
    { id: "SOL-USD", name: "Solana" },
    { id: "BTC-USD", name: "Altered Bitcoin", fixed: false },
    { id: "DOGE-USD", name: "Dogecoin" },
    { id: "SOL-USD", name: "Duplicate Solana" },
    { id: "ADA-USD", name: "Cardano" },
    { id: "XRP-USD", name: "XRP" },
    { id: "LINK-USD", name: "Chainlink" },
    { id: "AVAX-USD", name: "Avalanche" },
    { id: "DOT-USD", name: "Polkadot" },
  ];

  const saved = saveWatchlist(input, storage);
  assert.deepEqual(saved.map((entry) => entry.id), [
    "BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD", "ADA-USD", "XRP-USD", "LINK-USD", "AVAX-USD",
  ]);
  assert.deepEqual(saved.slice(0, 2), DEFAULT_PRODUCTS);
  assert.equal(saved.every((entry, index) => entry.fixed === (index < 2)), true);

  const key = [...storage.values.keys()][0];
  assert.match(key, /watchlist\.v1$/);
  const persisted = JSON.parse(storage.values.get(key));
  assert.equal(persisted.version, 1);
  assert.deepEqual(loadWatchlist(storage), saved);
});

test("stored text is cleaned while exchange mappings are validated", () => {
  const storage = memoryStorage();
  const saved = saveWatchlist([{
    id: "sol-usd",
    symbol: "BAD",
    name: "  Solana\u0000  Network  ",
    krakenSymbol: "BAD/PAIR",
    bitstampSymbol: "SOLUSD",
    bitfinexSymbol: "tSOL:USD",
    fixed: true,
  }], storage);
  assert.deepEqual(saved[2], {
    id: "SOL-USD",
    symbol: "SOL",
    name: "Solana Network",
    krakenSymbol: null,
    bitstampSymbol: "solusd",
    bitfinexSymbol: "tSOL:USD",
    fixed: false,
  });

  const rejected = saveWatchlist([{
    id: "SOL-USD",
    name: "Solana",
    bitstampSymbol: "solusdt",
    bitfinexSymbol: "tDOGEUSD",
  }]);
  assert.equal(rejected[2].bitstampSymbol, null);
  assert.equal(rejected[2].bitfinexSymbol, null);
});

test("damaged, obsolete, unavailable, and throwing storage safely fall back", () => {
  for (const raw of ["not json", "null", "[]", JSON.stringify({ version: 2, products: [] })]) {
    const storage = memoryStorage({ "crypto-top.watchlist.v1": raw });
    assert.deepEqual(loadWatchlist(storage), DEFAULT_PRODUCTS);
  }

  assert.deepEqual(loadWatchlist(null), DEFAULT_PRODUCTS);
  assert.deepEqual(loadWatchlist({ getItem() { throw new Error("blocked"); } }), DEFAULT_PRODUCTS);
  const result = saveWatchlist([{ id: "SOL-USD", name: "Solana" }], {
    setItem() { throw new Error("quota"); },
  });
  assert.deepEqual(result.map((entry) => entry.id), ["BTC-USD", "ETH-USD", "SOL-USD"]);
});

test("partially damaged stored product arrays retain only safe valid products", () => {
  const storage = memoryStorage({
    "crypto-top.watchlist.v1": JSON.stringify({
      version: 1,
      products: [null, { id: "SOL-USDT" }, { id: "SOL-USD", name: "Solana" }, { id: 42 }],
    }),
  });
  assert.deepEqual(loadWatchlist(storage).map((entry) => entry.id), ["BTC-USD", "ETH-USD", "SOL-USD"]);
});

test("catalog parsing accepts only active real-USD Coinbase products", () => {
  const products = [
    product("SOL-USD", { display_name: "Wrong product name" }),
    product("BTC-USD"),
    product("LINK-USD", { limit_only: true }),
    product("OFF-USD", { status: "offline" }),
    product("EUR-EUR", { base_currency: "EUR", quote_currency: "EUR" }),
    product("BAD-USDT", { base_currency: "BAD", quote_currency: "USDT" }),
    product("DISABLED-USD", { trading_disabled: true }),
    product("CANCEL-USD", { cancel_only: true }),
    product("POST-USD", { post_only: true }),
    product("MISMATCH-USD", { base_currency: "OTHER" }),
    product("sol-usd", { base_currency: "SOL" }),
    product("SOL-USD"),
    null,
  ];
  const currencies = [
    { id: "BTC", name: "Bitcoin from currencies" },
    { id: "LINK", name: "Chainlink" },
    { id: "SOL", name: "  Solana\nNetwork  " },
  ];

  const catalog = parseProductCatalog(products, currencies);
  assert.deepEqual(catalog, [
    {
      id: "BTC-USD",
      symbol: "BTC",
      name: "Bitcoin from currencies",
      krakenSymbol: "BTC/USD",
      bitstampSymbol: "btcusd",
      bitfinexSymbol: "tBTCUSD",
      fixed: true,
    },
    {
      id: "LINK-USD",
      symbol: "LINK",
      name: "Chainlink",
      krakenSymbol: null,
      bitstampSymbol: null,
      bitfinexSymbol: null,
      fixed: false,
    },
    {
      id: "SOL-USD",
      symbol: "SOL",
      name: "Solana Network",
      krakenSymbol: null,
      bitstampSymbol: null,
      bitfinexSymbol: null,
      fixed: false,
    },
  ]);
});

test("catalog parsing tolerates malformed payloads and missing currency names", () => {
  assert.deepEqual(parseProductCatalog(null, []), []);
  assert.deepEqual(parseProductCatalog({}, {}), []);
  assert.deepEqual(parseProductCatalog([product("AAVE-USD")], null), [{
    id: "AAVE-USD",
    symbol: "AAVE",
    name: "AAVE",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    fixed: false,
  }]);
});

test("fetchProductCatalog calls only the two public Coinbase Exchange endpoints", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => url.endsWith("/products")
        ? [product("SOL-USD")]
        : [{ id: "SOL", name: "Solana" }],
    };
  };

  assert.deepEqual(await fetchProductCatalog(fetchImpl), [{
    id: "SOL-USD",
    symbol: "SOL",
    name: "Solana",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    fixed: false,
  }]);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.exchange.coinbase.com/products",
    "https://api.exchange.coinbase.com/currencies",
  ]);
  for (const call of calls) {
    assert.deepEqual(call.options, { cache: "no-store", headers: { Accept: "application/json" } });
    assert.equal(Object.prototype.hasOwnProperty.call(call.options.headers, "Authorization"), false);
  }
});

test("fetchProductCatalog reports invalid fetch implementations and HTTP failures", async () => {
  await assert.rejects(() => fetchProductCatalog(null), /fetchImpl/);
  await assert.rejects(() => fetchProductCatalog(async (url) => ({
    ok: !url.endsWith("/products"),
    status: 503,
    json: async () => [],
  })), /Coinbase products request failed 503/);

  await assert.rejects(() => fetchProductCatalog(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  })), /catalog response is invalid/);

  await assert.rejects(() => fetchProductCatalog(async () => ({
    ok: true,
    status: 200,
    json: async () => [],
  })), /catalog is empty/);
});

test("Bitstamp directory accepts only enabled spot markets quoted in real USD", () => {
  const mappings = parseBitstampMarkets([
    {
      base_currency: "SOL",
      counter_currency: "USD",
      market_symbol: "solusd",
      market_type: "SPOT",
      trading: "Enabled",
    },
    {
      base_currency: "BTC",
      counter_currency: "USD",
      market_symbol: "BTCUSD",
      market_type: "SPOT",
      trading: "Enabled",
    },
    {
      base_currency: "DOGE",
      counter_currency: "USDT",
      market_symbol: "dogeusdt",
      market_type: "SPOT",
      trading: "Enabled",
    },
    {
      base_currency: "ADA",
      counter_currency: "USD",
      market_symbol: "adausd",
      market_type: "SPOT",
      trading: "Disabled",
    },
    {
      base_currency: "XRP",
      counter_currency: "USD",
      market_symbol: "xrpusd",
      market_type: "FUTURES",
      trading: "Enabled",
    },
    {
      base_currency: "AVAX",
      counter_currency: "USD",
      market_symbol: "linkusd",
      market_type: "SPOT",
      trading: "Enabled",
    },
    {
      base_currency: "bad symbol",
      counter_currency: "USD",
      market_symbol: "bad-symbolusd",
      market_type: "SPOT",
      trading: "Enabled",
    },
    null,
  ]);

  assert.deepEqual([...mappings], [
    ["SOL", "solusd"],
    ["BTC", "btcusd"],
  ]);
  assert.equal(parseBitstampMarkets(null), null);
  assert.equal(parseBitstampMarkets({ data: [] }), null);
});

test("Bitfinex pair parsing keeps exact USD pairs and rejects USDT, test, and malformed pairs", () => {
  const mappings = parseBitfinexPairs([[
    "BTCUSD",
    "SOL:USD",
    "DOGE:USDT",
    "XRPUSDT",
    "TESTBTCUSD",
    "ETH:EUR",
    "BAD::USD",
    "",
    42,
    "SOL:USD",
  ]]);

  assert.deepEqual([...mappings], [
    ["BTC", "tBTCUSD"],
    ["SOL", "tSOL:USD"],
  ]);
  assert.equal(parseBitfinexPairs(null), null);
  assert.equal(parseBitfinexPairs([]), null);
  assert.equal(parseBitfinexPairs([{}]), null);
});

test("backup mappings enrich only precise exchange pairs and survive persistence", () => {
  const enriched = applyBackupSourceMappings([
    { id: "SOL-USD", name: "Solana" },
    { id: "DOGE-USD", name: "Dogecoin" },
    { id: "BTC-USD", bitstampSymbol: "wrongusd", bitfinexSymbol: "tWRONGUSD" },
  ], {
    bitstamp: new Map([["BTC", "btcusd"], ["SOL", "solusd"]]),
    bitfinex: new Map([
      ["BTC", "tBTCUSD"],
      ["SOL", "tSOL:USD"],
      ["DOGE", "tDOGEUSD"],
    ]),
  });

  assert.deepEqual(enriched, [
    {
      id: "SOL-USD",
      symbol: "SOL",
      name: "Solana",
      krakenSymbol: null,
      bitstampSymbol: "solusd",
      bitfinexSymbol: "tSOL:USD",
      fixed: false,
    },
    {
      id: "DOGE-USD",
      symbol: "DOGE",
      name: "Dogecoin",
      krakenSymbol: null,
      bitstampSymbol: null,
      bitfinexSymbol: "tDOGEUSD",
      fixed: false,
    },
    DEFAULT_PRODUCTS[0],
  ]);

  const storage = memoryStorage();
  const saved = saveWatchlist(enriched, storage);
  assert.deepEqual(loadWatchlist(storage), saved);
  assert.equal(saved[2].bitstampSymbol, "solusd");
  assert.equal(saved[2].bitfinexSymbol, "tSOL:USD");
  assert.equal(saved[3].bitstampSymbol, null);
  assert.equal(saved[3].bitfinexSymbol, "tDOGEUSD");

  const delisted = applyBackupSourceMappings(DEFAULT_PRODUCTS, {
    bitstamp: new Map([["ETH", "ethusd"]]),
    bitfinex: null,
  });
  assert.equal(delisted[0].bitstampSymbol, null);
  assert.equal(delisted[0].bitfinexSymbol, "tBTCUSD");
  assert.equal(delisted[1].bitstampSymbol, "ethusd");
});

test("the optional backup directory is keyless and fails without breaking the watchlist", async () => {
  const calls = [];
  const success = await fetchBackupSourceMappings(async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => [{
        base_currency: "SOL",
        counter_currency: "USD",
        market_symbol: "solusd",
        market_type: "SPOT",
        trading: "Enabled",
      }],
    };
  });

  assert.deepEqual([...success.bitstamp], [["SOL", "solusd"]]);
  assert.equal(success.bitfinex, null);
  assert.deepEqual(calls.map((call) => call.url), [
    "https://www.bitstamp.net/api/v2/markets/",
  ]);
  assert.deepEqual(calls[0].options, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].options.headers, "Authorization"), false);

  assert.deepEqual(await fetchBackupSourceMappings(async () => ({
    ok: false,
    status: 503,
    json: async () => [],
  })), { bitstamp: null, bitfinex: null });
  assert.deepEqual(await fetchBackupSourceMappings(async () => {
    throw new Error("offline");
  }), { bitstamp: null, bitfinex: null });
  await assert.rejects(() => fetchBackupSourceMappings(null), /fetchImpl/);
});

test("search ranks exact symbols, prefixes, and currency names case-insensitively", () => {
  const catalog = parseProductCatalog([
    product("BTC-USD"),
    product("BCH-USD"),
    product("SOL-USD"),
    product("WELL-USD"),
  ], [
    { id: "BTC", name: "Bitcoin" },
    { id: "BCH", name: "Bitcoin Cash" },
    { id: "SOL", name: "Solana" },
    { id: "WELL", name: "Moonwell" },
  ]);

  assert.deepEqual(searchProducts(catalog, "btc", 5).map((entry) => entry.id), ["BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "bit", 5).map((entry) => entry.id), ["BCH-USD", "BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "well", 5).map((entry) => entry.id), ["WELL-USD"]);
  assert.deepEqual(searchProducts(catalog, "  SOL-usd ", 5).map((entry) => entry.id), ["SOL-USD"]);
  assert.deepEqual(searchProducts(catalog, "usd", 2).map((entry) => entry.id), ["BCH-USD", "BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "missing", 5), []);
});

test("search obeys limits, handles empty input, and does not mutate the catalog", () => {
  const catalog = [
    { id: "SOL-USD", symbol: "SOL", name: "Solana", krakenSymbol: null, fixed: false },
    { id: "BTC-USD", symbol: "BTC", name: "Bitcoin", krakenSymbol: "BTC/USD", fixed: true },
  ];
  const snapshot = JSON.stringify(catalog);
  assert.deepEqual(searchProducts(catalog, "", 1).map((entry) => entry.id), ["BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "", 0), []);
  assert.deepEqual(searchProducts(catalog, "", -1), []);
  assert.deepEqual(searchProducts(null, "btc", 5), []);
  assert.equal(JSON.stringify(catalog), snapshot);
});
