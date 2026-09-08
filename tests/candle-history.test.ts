import test from "node:test";
import assert from "node:assert/strict";
import {
  CANDLE_HISTORY_LIMIT,
  CANDLE_INTERVALS,
  CandleHistoryError,
  candleIntervalLabel,
  candleSourceLabel,
  fetchCandleHistory,
  fetchCandleHistoryPage,
  type CandleInterval,
} from "../src/candle-history.ts";
import type { MarketSource } from "../src/price-feed.ts";
import type { Product } from "../src/watchlist.ts";

const BTC_PRODUCT: Product = {
  id: "BTC-USD",
  symbol: "BTC",
  name: "Bitcoin",
  krakenSymbol: "BTC/USD",
  bitstampSymbol: "btcusd",
  bitfinexSymbol: "tBTCUSD",
  fixed: true,
};

const MU_PRODUCT: Product = {
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
};

function response(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: CandleHistoryError["code"],
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => (
    error instanceof CandleHistoryError && error.code === code
  ));
}

test("exports the five common candle intervals and supported source labels", () => {
  assert.deepEqual(CANDLE_INTERVALS, [
    { value: "1m", label: "1分" },
    { value: "5m", label: "5分" },
    { value: "15m", label: "15分" },
    { value: "1h", label: "1小时" },
    { value: "1d", label: "1天" },
  ]);
  assert.equal(candleIntervalLabel("15m"), "15分");
  assert.equal(candleSourceLabel("coinbase"), "Coinbase");
  assert.equal(candleSourceLabel("bybit"), "Bybit");
  assert.equal(candleSourceLabel("gate"), "Gate");
  assert.equal(candleSourceLabel("kraken"), null);
  assert.equal(candleSourceLabel(null), null);
  assert.throws(
    () => candleIntervalLabel("30m" as CandleInterval),
    (error: unknown) => error instanceof CandleHistoryError && error.code === "invalid-interval",
  );
});

test("fetches, validates, de-duplicates, and sorts Coinbase USD spot candles", async () => {
  const now = Date.parse("2026-09-01T12:34:56.789Z");
  const bucket = Math.floor(now / 60_000) * 60_000;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const candles = await fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response([
        [(bucket - 60_000) / 1_000, "101", "110", "102", "109", "2"],
        [(bucket - 60_000) / 1_000, "1", "999", "1", "999", "2"],
        [(bucket - 120_000) / 1_000, "99", "105", "100", "104", "3"],
        [(bucket - 180_000) / 1_000, "100", "102", "101", "103", "1"],
        [(bucket - (CANDLE_HISTORY_LIMIT + 10) * 60_000) / 1_000, "1", "2", "1", "2", "1"],
      ]);
    },
  });

  assert.deepEqual(candles, [
    { openTime: bucket - 120_000, open: 100, high: 105, low: 99, close: 104 },
    { openTime: bucket - 60_000, open: 102, high: 110, low: 101, close: 109 },
  ]);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://api.exchange.coinbase.com");
  assert.equal(url.pathname, "/products/BTC-USD/candles");
  assert.equal(url.searchParams.get("granularity"), "60");
  assert.equal(Date.parse(url.searchParams.get("end")!), now);
  assert.equal(
    Date.parse(url.searchParams.get("start")!),
    bucket - ((CANDLE_HISTORY_LIMIT - 1) * 60_000),
  );
  assert.equal(calls[0].init.cache, "no-store");
  assert.deepEqual(calls[0].init.headers, { Accept: "application/json" });
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].init.headers!, "Authorization"), false);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("fetches Bybit candles with the exact catalog symbol and provider interval", async () => {
  const now = Date.parse("2026-09-01T12:34:56.000Z");
  const bucket = Math.floor(now / 3_600_000) * 3_600_000;
  let requestedUrl = "";
  const candles = await fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "bybit",
    interval: "1h",
    now: () => now,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return response({
        retCode: 0,
        result: {
          symbol: "MUUSDT",
          list: [
            [String(bucket), "102", "110", "101", "109", "4", "400"],
            [String(bucket - 3_600_000), "100", "105", "99", "104", "3", "300"],
          ],
        },
      });
    },
  });

  assert.deepEqual(candles.map((candle) => candle.openTime), [bucket - 3_600_000, bucket]);
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://api.bybit.com");
  assert.equal(url.pathname, "/v5/market/kline");
  assert.equal(url.searchParams.get("category"), "linear");
  assert.equal(url.searchParams.get("symbol"), "MUUSDT");
  assert.equal(url.searchParams.get("interval"), "60");
  assert.equal(url.searchParams.get("limit"), String(CANDLE_HISTORY_LIMIT));
  assert.equal(url.searchParams.get("start"), String(bucket - ((CANDLE_HISTORY_LIMIT - 1) * 3_600_000)));
  assert.equal(url.searchParams.get("end"), String(now));
});

test("fetches Gate candles with the exact catalog contract and second timestamps", async () => {
  const now = Date.parse("2026-09-01T12:34:56.000Z");
  const bucket = Math.floor(now / 86_400_000) * 86_400_000;
  let requestedUrl = "";
  const candles = await fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "gate",
    interval: "1d",
    now: () => now,
    fetchImpl: async (url) => {
      requestedUrl = url;
      return response([
        { t: String(bucket / 1_000), o: "100", h: "110", l: "99", c: "109" },
        { t: String((bucket - 86_400_000) / 1_000), o: "98", h: "105", l: "95", c: "101" },
      ]);
    },
  });

  assert.deepEqual(candles.map((candle) => candle.openTime), [bucket - 86_400_000, bucket]);
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://api.gateio.ws");
  assert.equal(url.pathname, "/api/v4/futures/usdt/candlesticks");
  assert.equal(url.searchParams.get("contract"), "MU_USDT");
  assert.equal(url.searchParams.get("interval"), "1d");
  assert.equal(
    url.searchParams.get("from"),
    String((bucket - ((CANDLE_HISTORY_LIMIT - 1) * 86_400_000)) / 1_000),
  );
  assert.equal(url.searchParams.get("to"), String(Math.floor(now / 1_000)));
});

test("caps normalized history at the latest 240 candles", async () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const payload = Array.from({ length: CANDLE_HISTORY_LIMIT + 20 }, (_, index) => {
    const time = (now - (index * 60_000)) / 1_000;
    return [time, "99", "105", "100", "104", "1"];
  });
  const candles = await fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    fetchImpl: async () => response(payload),
  });

  assert.equal(candles.length, CANDLE_HISTORY_LIMIT);
  assert.equal(candles[0].openTime, now - ((CANDLE_HISTORY_LIMIT - 1) * 60_000));
  assert.equal(candles.at(-1)!.openTime, now);
});

test("rejects unavailable display sources without making a fallback request", async () => {
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls += 1;
    return response([]);
  };
  for (const marketSource of ["kraken", "bitstamp", "bitfinex", null] as const) {
    await rejectsWithCode(fetchCandleHistory({
      product: BTC_PRODUCT,
      marketSource,
      interval: "1m",
      fetchImpl,
    }), "unsupported-source");
  }
  assert.equal(fetchCalls, 0);
});

test("rejects cross-class products and missing exact perpetual mappings", async () => {
  const unusedFetch = async () => response([]);
  await rejectsWithCode(fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "coinbase",
    interval: "5m",
    fetchImpl: unusedFetch,
  }), "invalid-product");
  await rejectsWithCode(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "bybit",
    interval: "5m",
    fetchImpl: unusedFetch,
  }), "invalid-product");
  await rejectsWithCode(fetchCandleHistory({
    product: { ...MU_PRODUCT, bybitSymbol: null },
    marketSource: "bybit",
    interval: "5m",
    fetchImpl: unusedFetch,
  }), "missing-symbol");
  await rejectsWithCode(fetchCandleHistory({
    product: { ...MU_PRODUCT, gateSymbol: "AAPL_USDT" },
    marketSource: "gate",
    interval: "5m",
    fetchImpl: unusedFetch,
  }), "missing-symbol");
});

test("distinguishes empty history from provider, HTTP, and malformed responses", async () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  assert.deepEqual(await fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response([]),
  }), []);
  assert.deepEqual(await fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "bybit",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response({ retCode: 0, result: { symbol: "MUUSDT", list: [] } }),
  }), []);

  await rejectsWithCode(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response([], 429),
  }), "http");
  await rejectsWithCode(fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "bybit",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response({ retCode: 10001, retMsg: "bad request" }),
  }), "provider");
  await rejectsWithCode(fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "bybit",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response({
      retCode: 0,
      result: { symbol: "AAPLUSDT", list: [] },
    }),
  }), "malformed-response");
  await rejectsWithCode(fetchCandleHistory({
    product: MU_PRODUCT,
    marketSource: "gate",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => response([{ t: "bad", o: "1", h: "2", l: "1", c: "2" }]),
  }), "malformed-response");
  await rejectsWithCode(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "5m",
    now: () => now,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }),
  }), "malformed-response");
});

test("preserves AbortError for already-aborted and in-flight requests", async () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  let fetchCalls = 0;
  await assert.rejects(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    signal: alreadyAborted.signal,
    fetchImpl: async () => {
      fetchCalls += 1;
      return response([]);
    },
  }), (error: unknown) => error instanceof Error && error.name === "AbortError");
  assert.equal(fetchCalls, 0);

  const controller = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const pending = fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    signal: controller.signal,
    fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
      markStarted();
      init.signal!.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
  });
  await started;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && error.name === "AbortError");

  const parsingController = new AbortController();
  let finishJson!: () => void;
  let markJsonStarted!: () => void;
  const jsonStarted = new Promise<void>((resolve) => {
    markJsonStarted = resolve;
  });
  const parsing = fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    signal: parsingController.signal,
    fetchImpl: async () => response(new Promise<void>((resolve) => {
      finishJson = resolve;
      markJsonStarted();
    })),
  });
  await jsonStarted;
  parsingController.abort();
  finishJson();
  await assert.rejects(parsing, (error: unknown) => (
    error instanceof Error && error.name === "AbortError"
  ));
});

test("binds the runtime fetch method to globalThis", async () => {
  const originalFetch = globalThis.fetch;
  let observedThis: typeof globalThis | null = null;
  globalThis.fetch = function fakeFetch(this: typeof globalThis) {
    observedThis = this;
    return Promise.resolve(new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  } as typeof fetch;

  try {
    const candles = await fetchCandleHistory({
      product: BTC_PRODUCT,
      marketSource: "coinbase",
      interval: "1d",
      now: () => Date.parse("2026-09-01T12:00:00.000Z"),
    });
    assert.deepEqual(candles, []);
    assert.equal(observedThis, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wraps ordinary transport failures without changing abort failures", async () => {
  await rejectsWithCode(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1d",
    now: () => Date.parse("2026-09-01T12:00:00.000Z"),
    fetchImpl: async () => {
      throw new TypeError("offline");
    },
  }), "network");
  await rejectsWithCode(fetchCandleHistory({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1d",
    fetchImpl: null,
  }), "fetch-unavailable");
});

test("all declared market sources remain covered by the strict source boundary", () => {
  const sources: MarketSource[] = ["coinbase", "kraken", "bitstamp", "bitfinex", "bybit", "gate"];
  assert.deepEqual(sources.map(candleSourceLabel), ["Coinbase", null, null, null, "Bybit", "Gate"]);
});

test("history pages use exclusive older windows for every provider and interval", async () => {
  const before = Date.parse("2026-09-01T00:00:00.000Z");
  const intervals = [
    { interval: "1m", duration: 60_000, coinbase: "60", bybit: "1" },
    { interval: "5m", duration: 300_000, coinbase: "300", bybit: "5" },
    { interval: "15m", duration: 900_000, coinbase: "900", bybit: "15" },
    { interval: "1h", duration: 3_600_000, coinbase: "3600", bybit: "60" },
    { interval: "1d", duration: 86_400_000, coinbase: "86400", bybit: "D" },
  ] as const;

  for (const source of ["coinbase", "bybit", "gate"] as const) {
    for (const entry of intervals) {
      let requestedUrl = "";
      const page = await fetchCandleHistoryPage({
        product: source === "coinbase" ? BTC_PRODUCT : MU_PRODUCT,
        marketSource: source,
        interval: entry.interval,
        before,
        now: () => { throw new Error("Older pages must use their frozen cursor"); },
        fetchImpl: async (url) => {
          requestedUrl = url;
          return response(source === "bybit"
            ? { retCode: 0, result: { symbol: "MUUSDT", list: [] } }
            : []);
        },
      });
      const start = before - CANDLE_HISTORY_LIMIT * entry.duration;
      assert.deepEqual(page, { candles: [], nextBefore: start });
      const url = new URL(requestedUrl);
      if (source === "coinbase") {
        assert.equal(url.origin, "https://api.exchange.coinbase.com");
        assert.equal(url.pathname, "/products/BTC-USD/candles");
        assert.equal(url.searchParams.get("granularity"), entry.coinbase);
        assert.equal(Date.parse(url.searchParams.get("start")!), start);
        assert.equal(Date.parse(url.searchParams.get("end")!), before - 1);
      } else if (source === "bybit") {
        assert.equal(url.origin, "https://api.bybit.com");
        assert.equal(url.pathname, "/v5/market/kline");
        assert.equal(url.searchParams.get("symbol"), "MUUSDT");
        assert.equal(url.searchParams.get("category"), "linear");
        assert.equal(url.searchParams.get("interval"), entry.bybit);
        assert.equal(Number(url.searchParams.get("start")), start);
        assert.equal(Number(url.searchParams.get("end")), before - 1);
        assert.equal(Number(url.searchParams.get("limit")), CANDLE_HISTORY_LIMIT);
      } else {
        assert.equal(url.origin, "https://api.gateio.ws");
        assert.equal(url.pathname, "/api/v4/futures/usdt/candlesticks");
        assert.equal(url.searchParams.get("contract"), "MU_USDT");
        assert.equal(url.searchParams.get("interval"), entry.interval);
        assert.equal(Number(url.searchParams.get("from")), start / 1_000);
        assert.equal(Number(url.searchParams.get("to")), before / 1_000 - 1);
        assert.equal(url.searchParams.has("limit"), false);
      }
    }
  }
});

test("adjacent pages exclude repeated provider boundaries and retain the complete page", async () => {
  const now = Date.parse("2026-09-01T12:34:56.789Z");
  const bucket = Math.floor(now / 60_000) * 60_000;
  const oldestRecent = bucket - (CANDLE_HISTORY_LIMIT - 1) * 60_000;
  const first = await fetchCandleHistoryPage({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    now: () => now,
    fetchImpl: async () => response([[oldestRecent / 1_000, 99, 105, 100, 104]]),
  });
  assert.equal(first.nextBefore, oldestRecent);

  for (const source of ["coinbase", "bybit", "gate"] as const) {
    const times = Array.from({ length: CANDLE_HISTORY_LIMIT + 2 }, (_, i) => oldestRecent - i * 60_000);
    times.splice(2, 0, times[1]);
    const payload = source === "coinbase"
      ? times.map((time) => [time / 1_000, 99, 105, 100, 104])
      : source === "bybit"
        ? { retCode: 0, result: {
          symbol: "MUUSDT",
          list: times.map((time) => [String(time), "100", "105", "99", "104"]),
        } }
        : times.map((time) => ({ t: time / 1_000, o: 100, h: 105, l: 99, c: 104 }));
    const older = await fetchCandleHistoryPage({
      product: source === "coinbase" ? BTC_PRODUCT : MU_PRODUCT,
      marketSource: source,
      interval: "1m",
      before: first.nextBefore,
      fetchImpl: async () => response(payload),
    });
    assert.equal(older.candles.length, CANDLE_HISTORY_LIMIT);
    assert.equal(older.nextBefore, oldestRecent - CANDLE_HISTORY_LIMIT * 60_000);
    assert.equal(older.candles[0].openTime, older.nextBefore);
    assert.equal(older.candles.at(-1)!.openTime, oldestRecent - 60_000);
    assert.equal(new Set(older.candles.map((candle) => candle.openTime)).size, CANDLE_HISTORY_LIMIT);
    assert.ok(older.candles.every((candle) => candle.openTime < first.candles[0].openTime));
  }
});

test("sparse and empty windows advance by the scanned range instead of the returned candles", async () => {
  const before = Date.parse("2026-09-01T12:00:00.000Z");
  const sparse = await fetchCandleHistoryPage({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    before,
    fetchImpl: async () => response([
      [(before - 5 * 60_000) / 1_000, 99, 105, 100, 104],
      [(before - 100 * 60_000) / 1_000, 99, 105, 100, 104],
    ]),
  });
  assert.equal(sparse.nextBefore, before - CANDLE_HISTORY_LIMIT * 60_000);
  assert.deepEqual(sparse.candles.map((candle) => candle.openTime), [
    before - 100 * 60_000,
    before - 5 * 60_000,
  ]);
  const empty = await fetchCandleHistoryPage({
    product: BTC_PRODUCT,
    marketSource: "coinbase",
    interval: "1m",
    before: sparse.nextBefore,
    fetchImpl: async () => response([]),
  });
  assert.deepEqual(empty, {
    candles: [],
    nextBefore: before - 2 * CANDLE_HISTORY_LIMIT * 60_000,
  });
});

test("history pagination validates time and ends at the epoch without a negative cursor", async () => {
  let fetchCalls = 0;
  const options = {
    product: BTC_PRODUCT,
    marketSource: "coinbase" as const,
    interval: "1m" as const,
    fetchImpl: async () => { fetchCalls += 1; return response([]); },
  };
  for (const before of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER, "1", null]) {
    await rejectsWithCode(fetchCandleHistoryPage({
      ...options,
      before: before as number,
    }), "invalid-time");
  }
  for (const now of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER, 1]) {
    await rejectsWithCode(fetchCandleHistory({ ...options, now: () => now }), "invalid-time");
  }
  await rejectsWithCode(fetchCandleHistory({
    ...options,
    now: () => { throw new Error("clock unavailable"); },
  }), "invalid-time");
  assert.equal(fetchCalls, 0);

  let requestedUrl = "";
  const last = await fetchCandleHistoryPage({
    ...options,
    before: 60_000,
    fetchImpl: async (url) => { requestedUrl = url; return response([]); },
  });
  assert.deepEqual(last, { candles: [], nextBefore: 0 });
  const url = new URL(requestedUrl);
  assert.equal(Date.parse(url.searchParams.get("start")!), 0);
  assert.equal(Date.parse(url.searchParams.get("end")!), 59_999);
});

test("older pages reject unsupported sources before making any request", async () => {
  let fetchCalls = 0;
  for (const marketSource of [null, undefined, "kraken", "bitstamp", "bitfinex"] as const) {
    await rejectsWithCode(fetchCandleHistoryPage({
      product: BTC_PRODUCT,
      marketSource,
      interval: "1m",
      before: Date.parse("2026-09-01T12:00:00.000Z"),
      fetchImpl: async () => { fetchCalls += 1; return response([]); },
    }), "unsupported-source");
  }
  assert.equal(fetchCalls, 0);
});

test("older pages remain cancellable before fetch, in transport, and while parsing", async () => {
  const options = {
    product: BTC_PRODUCT,
    marketSource: "coinbase" as const,
    interval: "1m" as const,
    before: Date.parse("2026-09-01T12:00:00.000Z"),
  };
  const isAbort = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(fetchCandleHistoryPage({
    ...options,
    signal: alreadyAborted.signal,
    fetchImpl: async () => { assert.fail("Aborted page must not fetch"); },
  }), isAbort);

  for (const phase of ["transport", "json"] as const) {
    const controller = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let finishJson!: () => void;
    const pending = fetchCandleHistoryPage({
      ...options,
      signal: controller.signal,
      fetchImpl: async (_url, init) => {
        if (phase === "transport") {
          return new Promise((_resolve, reject) => {
            init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            markStarted();
          });
        }
        return {
          ok: true,
          status: 200,
          json: async () => new Promise<unknown>((resolve) => {
            finishJson = () => resolve([]);
            markStarted();
          }),
        };
      },
    });
    await started;
    controller.abort();
    if (phase === "json") finishJson();
    await assert.rejects(pending, isAbort);
  }
});
