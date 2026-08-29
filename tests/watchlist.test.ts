import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PRODUCTS,
  MAX_PRODUCTS,
  applyBackupSourceMappings,
  applyGateStockMappings,
  fetchBackupSourceMappings,
  fetchProductCatalog,
  fetchProductCatalogSnapshot,
  inferProduct,
  loadWatchlist,
  mergeStockCatalogs,
  parseBitfinexPairs,
  parseBitstampMarkets,
  parseBybitStockCatalog,
  parseGateStockCatalog,
  parseGateStockMappings,
  parseProductCatalog,
  refreshProductsFromCatalog,
  saveWatchlist,
  searchProducts,
} from "../src/watchlist.ts";

interface MemoryStorage {
  values: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface CoinbaseProductPayload extends Record<string, unknown> {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: string;
  trading_disabled: boolean;
  cancel_only: boolean;
  post_only: boolean;
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    values,
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function product(
  id: string,
  overrides: Record<string, unknown> = {},
): CoinbaseProductPayload {
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

  const key = [...storage.values.keys()][0]!;
  assert.match(key, /watchlist\.v1$/);
  const persisted = JSON.parse(storage.values.get(key)!) as { version: unknown };
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

test("US-stock perpetual directories require exact official metadata and mappings", () => {
  const bybit = parseBybitStockCatalog({
    retCode: 0,
    result: { list: [
      {
        symbol: "MUUSDT",
        symbolType: "stock",
        marketRegion: "US",
        contractType: "LinearPerpetual",
        status: "Trading",
        quoteCoin: "USDT",
        settleCoin: "USDT",
        underlyingTicker: "MU",
        fullName: "Micron Technology",
      },
      {
        symbol: "AMDSTOCKUSDT",
        symbolType: "stock",
        marketRegion: "US",
        contractType: "LinearPerpetual",
        status: "Trading",
        quoteCoin: "USDT",
        settleCoin: "USDT",
        underlyingTicker: "AMD",
        fullName: "Advanced Micro Devices",
      },
      {
        symbol: "AAPLUSDT",
        symbolType: "stock",
        marketRegion: "EU",
        contractType: "LinearPerpetual",
        status: "Trading",
        quoteCoin: "USDT",
        settleCoin: "USDT",
        underlyingTicker: "AAPL",
        fullName: "Wrong region",
      },
      {
        symbol: "NVDAUSDT",
        symbolType: "stock",
        marketRegion: "US",
        contractType: "LinearPerpetual",
        status: "Settled",
        quoteCoin: "USDT",
        settleCoin: "USDT",
        underlyingTicker: "NVDA",
        fullName: "Inactive",
      },
    ] },
  });
  assert.deepEqual(bybit.map((entry) => [entry.id, entry.bybitSymbol]), [
    ["AMD-USDT-PERP", "AMDSTOCKUSDT"],
    ["MU-USDT-PERP", "MUUSDT"],
  ]);

  const gate = parseGateStockMappings([
    { name: "MU_USDT", contract_type: "stocks", status: "trading", in_delisting: false },
    { name: "AMD_USDT", contract_type: "stocks", status: "trading", in_delisting: false },
    { name: "AAPLX_USDT", contract_type: "stocks", status: "trading", in_delisting: false },
    { name: "BTC_USDT", contract_type: "crypto", status: "trading", in_delisting: false },
    { name: "OLD_USDT", contract_type: "stocks", status: "trading", in_delisting: true },
  ]);
  assert.deepEqual([...gate!], [
    ["AAPLX", "AAPLX_USDT"],
    ["AMD", "AMD_USDT"],
    ["MU", "MU_USDT"],
  ]);
  const merged = applyGateStockMappings(bybit, gate);
  assert.deepEqual(merged.map((entry) => [entry.id, entry.gateSymbol]), [
    ["AMD-USDT-PERP", "AMD_USDT"],
    ["MU-USDT-PERP", "MU_USDT"],
  ]);

  const gateCatalog = parseGateStockCatalog([
    { name: "MU_USDT", contract_type: "stocks", status: "trading", in_delisting: false },
    { name: "BA_USDT", contract_type: "stocks", status: "trading", in_delisting: false },
  ]);
  assert.deepEqual(gateCatalog.map((entry) => [entry.id, entry.gateSymbol]), [
    ["BA-USDT-PERP", "BA_USDT"],
    ["MU-USDT-PERP", "MU_USDT"],
  ]);
  assert.deepEqual(mergeStockCatalogs(bybit, gateCatalog).map((entry) => [
    entry.id,
    entry.bybitSymbol,
    entry.gateSymbol,
  ]), [
    ["AMD-USDT-PERP", "AMDSTOCKUSDT", null],
    ["BA-USDT-PERP", null, "BA_USDT"],
    ["MU-USDT-PERP", "MUUSDT", "MU_USDT"],
  ]);
});

test("stock perpetual watchlist entries persist exact exchange symbols", () => {
  const storage = memoryStorage();
  const saved = saveWatchlist(DEFAULT_PRODUCTS.concat([{
    id: "MU-USDT-PERP",
    symbol: "MU.P",
    name: "Micron Technology · USDT永续",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol: "MUUSDT",
    gateSymbol: "MU_USDT",
    quoteCurrency: "USDT",
    marketType: "perpetual",
    assetClass: "equity",
    fixed: false,
  }]), storage);
  assert.deepEqual(loadWatchlist(storage), saved);
  assert.equal(saved[2].bybitSymbol, "MUUSDT");
  assert.equal(saved[2].gateSymbol, "MU_USDT");
  assert.equal(saved[2].name, "Micron Technology · USDT永续");

  const rejected = saveWatchlist(DEFAULT_PRODUCTS.concat([{
    id: "MU-USDT-PERP",
    symbol: "MU.P",
    name: "Missing exact source",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    fixed: false,
  }]), memoryStorage());
  assert.equal(rejected.length, 2);
});

test("fetchProductCatalog merges keyless Coinbase and US-stock perpetual directories", async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const fetchImpl = async (url: string, options: RequestInit) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => {
        if (url.endsWith("/products")) return [product("SOL-USD")];
        if (url.endsWith("/currencies")) return [{ id: "SOL", name: "Solana" }];
        if (url.includes("api.bybit.com")) return {
          retCode: 0,
          result: { list: [{
            symbol: "MUUSDT",
            symbolType: "stock",
            marketRegion: "US",
            contractType: "LinearPerpetual",
            status: "Trading",
            quoteCoin: "USDT",
            settleCoin: "USDT",
            underlyingTicker: "MU",
            fullName: "Micron Technology",
          }] },
        };
        return [{
          name: "MU_USDT",
          contract_type: "stocks",
          status: "trading",
          in_delisting: false,
        }, {
          name: "BA_USDT",
          contract_type: "stocks",
          status: "trading",
          in_delisting: false,
        }];
      },
    };
  };

  const catalog = await fetchProductCatalog(fetchImpl);
  assert.deepEqual(catalog.map((entry) => entry.id), ["BA-USDT-PERP", "MU-USDT-PERP", "SOL-USD"]);
  assert.deepEqual(catalog.find((entry) => entry.id === "MU-USDT-PERP"), {
    id: "MU-USDT-PERP",
    symbol: "MU.P",
    name: "Micron Technology · USDT永续",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol: "MUUSDT",
    gateSymbol: "MU_USDT",
    quoteCurrency: "USDT",
    marketType: "perpetual",
    assetClass: "equity",
    fixed: false,
  });
  assert.deepEqual(catalog.find((entry) => entry.id === "BA-USDT-PERP"), {
    id: "BA-USDT-PERP",
    symbol: "BA.P",
    name: "BA · Gate USDT永续",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol: null,
    gateSymbol: "BA_USDT",
    quoteCurrency: "USDT",
    marketType: "perpetual",
    assetClass: "equity",
    fixed: false,
  });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.exchange.coinbase.com/products",
    "https://api.exchange.coinbase.com/currencies",
    "https://api.bybit.com/v5/market/instruments-info?category=linear&symbolType=stock&status=Trading&limit=1000",
    "https://api.gateio.ws/api/v4/futures/usdt/contracts",
  ]);
  for (const call of calls) {
    assert.deepEqual(call.options, { cache: "no-store", headers: { Accept: "application/json" } });
    assert.equal(Object.prototype.hasOwnProperty.call(call.options.headers, "Authorization"), false);
  }
});

test("product catalogs fail independently and only reject when every directory is empty", async () => {
  await assert.rejects(() => fetchProductCatalog(null), /fetchImpl/);
  await assert.rejects(() => fetchProductCatalog(async () => ({
    ok: false,
    status: 503,
    json: async () => [],
  })), /catalogs are unavailable or empty/);

  const snapshot = await fetchProductCatalogSnapshot(async (url: string) => ({
    ok: !url.includes("coinbase.com") && !url.includes("api.bybit.com"),
    status: 503,
    json: async () => url.includes("api.gateio.ws") ? [{
      name: "BA_USDT",
      contract_type: "stocks",
      status: "trading",
      in_delisting: false,
    }] : [],
  }));
  assert.deepEqual(snapshot.availability, { coinbase: false, bybit: false, gate: true });
  assert.deepEqual(snapshot.products.map((entry) => entry.id), ["BA-USDT-PERP"]);
});

test("a transient stock-directory failure preserves the last exact persisted mapping", () => {
  const selected = DEFAULT_PRODUCTS.concat([{
    id: "MU-USDT-PERP",
    symbol: "MU.P",
    name: "Micron Technology · USDT永续",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol: "MUUSDT",
    gateSymbol: "MU_USDT",
    quoteCurrency: "USDT" as const,
    marketType: "perpetual" as const,
    assetClass: "equity" as const,
    fixed: false,
  }]);
  const bybitOnly = [{ ...selected[2], gateSymbol: null }];
  const refreshed = refreshProductsFromCatalog(selected, {
    products: bybitOnly,
    availability: { coinbase: true, bybit: true, gate: false },
  });
  assert.equal(refreshed[2].bybitSymbol, "MUUSDT");
  assert.equal(refreshed[2].gateSymbol, "MU_USDT");

  const authoritative = refreshProductsFromCatalog(selected, {
    products: bybitOnly,
    availability: { coinbase: true, bybit: true, gate: true },
  });
  assert.equal(authoritative[2].gateSymbol, null);
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

  assert.deepEqual([...mappings!], [
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

  assert.deepEqual([...mappings!], [
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
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const success = await fetchBackupSourceMappings(async (url: string, options: RequestInit) => {
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

  assert.deepEqual([...success.bitstamp!], [["SOL", "solusd"]]);
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
  ]).concat([{
    id: "MU-USDT-PERP",
    symbol: "MU.P",
    name: "Micron Technology · USDT永续",
    krakenSymbol: null,
    bitstampSymbol: null,
    bitfinexSymbol: null,
    bybitSymbol: "MUUSDT",
    gateSymbol: "MU_USDT",
    quoteCurrency: "USDT",
    marketType: "perpetual",
    assetClass: "equity",
    fixed: false,
  }]);

  assert.deepEqual(searchProducts(catalog, "btc", 5).map((entry) => entry.id), ["BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "bit", 5).map((entry) => entry.id), ["BCH-USD", "BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "well", 5).map((entry) => entry.id), ["WELL-USD"]);
  assert.deepEqual(searchProducts(catalog, "  SOL-usd ", 5).map((entry) => entry.id), ["SOL-USD"]);
  assert.deepEqual(searchProducts(catalog, "usd", 2).map((entry) => entry.id), ["BCH-USD", "BTC-USD"]);
  assert.deepEqual(searchProducts(catalog, "mu", 5).map((entry) => entry.id), ["MU-USDT-PERP"]);
  assert.deepEqual(searchProducts(catalog, "micron", 5).map((entry) => entry.id), ["MU-USDT-PERP"]);
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
