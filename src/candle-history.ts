import type { FetchImpl, MarketSource } from "./price-feed.js";
import type { Product } from "./watchlist.js";

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CandleIntervalOption {
  value: CandleInterval;
  label: string;
}

export const CANDLE_INTERVALS: readonly Readonly<CandleIntervalOption>[] = Object.freeze([
  Object.freeze({ value: "1m", label: "1分" }),
  Object.freeze({ value: "5m", label: "5分" }),
  Object.freeze({ value: "15m", label: "15分" }),
  Object.freeze({ value: "1h", label: "1小时" }),
  Object.freeze({ value: "1d", label: "1天" }),
]);

export const CANDLE_HISTORY_LIMIT = 240;

export type CandleHistoryErrorCode =
  | "unsupported-source"
  | "invalid-product"
  | "missing-symbol"
  | "invalid-interval"
  | "invalid-time"
  | "fetch-unavailable"
  | "http"
  | "provider"
  | "malformed-response"
  | "timeout"
  | "network";

export class CandleHistoryError extends Error {
  readonly code: CandleHistoryErrorCode;
  readonly status: number | null;

  constructor(code: CandleHistoryErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "CandleHistoryError";
    this.code = code;
    this.status = status;
  }
}

export interface FetchCandleHistoryOptions {
  product: Product;
  marketSource: MarketSource | null | undefined;
  interval: CandleInterval;
  fetchImpl?: FetchImpl | null;
  now?: () => number;
  signal?: AbortSignal;
}

export interface FetchCandleHistoryPageOptions extends FetchCandleHistoryOptions {
  /** Exclusive candle open time, in milliseconds, for an older history page. */
  before?: number;
}

export interface CandleHistoryPage {
  candles: Candle[];
  /** Scanned window start, including empty windows; zero means the time origin. */
  nextBefore: number;
}

type CandleSource = "coinbase" | "bybit" | "gate";

interface IntervalConfig {
  durationMs: number;
  coinbase: number;
  bybit: string;
  gate: string;
}

interface CandleTarget {
  source: CandleSource;
  symbol: string;
}

interface RequestWindow {
  startAt: number;
  endAt: number;
}

const REQUEST_TIMEOUT_MS = 8_000;
const COINBASE_API_ROOT = "https://api.exchange.coinbase.com/products";
const BYBIT_API_ROOT = "https://api.bybit.com/v5/market";
const GATE_API_ROOT = "https://api.gateio.ws/api/v4/futures/usdt";

const INTERVAL_CONFIG: Readonly<Record<CandleInterval, Readonly<IntervalConfig>>> = Object.freeze({
  "1m": Object.freeze({ durationMs: 60_000, coinbase: 60, bybit: "1", gate: "1m" }),
  "5m": Object.freeze({ durationMs: 300_000, coinbase: 300, bybit: "5", gate: "5m" }),
  "15m": Object.freeze({ durationMs: 900_000, coinbase: 900, bybit: "15", gate: "15m" }),
  "1h": Object.freeze({ durationMs: 3_600_000, coinbase: 3_600, bybit: "60", gate: "1h" }),
  "1d": Object.freeze({ durationMs: 86_400_000, coinbase: 86_400, bybit: "D", gate: "1d" }),
});

const SOURCE_LABELS: Readonly<Record<CandleSource, string>> = Object.freeze({
  coinbase: "Coinbase",
  bybit: "Bybit",
  gate: "Gate",
});

function intervalConfig(interval: CandleInterval): Readonly<IntervalConfig> {
  const config = INTERVAL_CONFIG[interval];
  if (!config) {
    throw new CandleHistoryError("invalid-interval", "不支持的 K 线周期");
  }
  return config;
}

export function candleIntervalLabel(interval: CandleInterval): string {
  const option = CANDLE_INTERVALS.find((entry) => entry.value === interval);
  if (!option) {
    throw new CandleHistoryError("invalid-interval", "不支持的 K 线周期");
  }
  return option.label;
}

export function candleSourceLabel(source: MarketSource | null | undefined): string | null {
  return source === "coinbase" || source === "bybit" || source === "gate"
    ? SOURCE_LABELS[source]
    : null;
}

function resolveTarget(product: Product, marketSource: MarketSource | null | undefined): CandleTarget {
  if (marketSource !== "coinbase" && marketSource !== "bybit" && marketSource !== "gate") {
    throw new CandleHistoryError(
      "unsupported-source",
      marketSource
        ? `当前数据源 ${marketSource} 暂不支持 K 线`
        : "当前报价数据源尚不可用",
    );
  }

  if (marketSource === "coinbase") {
    const validSpot = product.marketType !== "perpetual"
      && product.quoteCurrency !== "USDT"
      && product.assetClass !== "equity"
      && /^[A-Z0-9][A-Z0-9._-]{0,63}-USD$/.test(product.id);
    if (!validSpot) {
      throw new CandleHistoryError("invalid-product", "Coinbase K 线仅支持真实 USD 加密现货");
    }
    return { source: "coinbase", symbol: product.id };
  }

  const validPerpetual = product.marketType === "perpetual"
    && product.quoteCurrency === "USDT"
    && product.assetClass === "equity"
    && /^([A-Z0-9][A-Z0-9.]{0,39})-USDT-PERP$/.test(product.id);
  if (!validPerpetual) {
    throw new CandleHistoryError("invalid-product", "该数据源仅支持已验证的股票相关 USDT 永续合约");
  }

  if (marketSource === "bybit") {
    const symbol = typeof product.bybitSymbol === "string"
      ? product.bybitSymbol.trim().toUpperCase()
      : "";
    if (!/^[A-Z0-9]{2,80}USDT$/.test(symbol)) {
      throw new CandleHistoryError("missing-symbol", "缺少已验证的 Bybit 合约映射");
    }
    return { source: "bybit", symbol };
  }

  const symbol = typeof product.gateSymbol === "string"
    ? product.gateSymbol.trim().toUpperCase()
    : "";
  const ticker = product.id.slice(0, -"-USDT-PERP".length);
  if (!/^[A-Z0-9]{1,80}_USDT$/.test(symbol) || symbol !== `${ticker}_USDT`) {
    throw new CandleHistoryError("missing-symbol", "缺少已验证的 Gate 合约映射");
  }
  return { source: "gate", symbol };
}

function requestWindow(
  now: () => number,
  durationMs: number,
  before: number | undefined,
): RequestWindow {
  let endAt: number;
  if (before === undefined) {
    try {
      endAt = Number(now());
    } catch {
      throw new CandleHistoryError("invalid-time", "无法确定 K 线请求时间");
    }
    if (!Number.isFinite(endAt) || endAt <= 0) {
      throw new CandleHistoryError("invalid-time", "无法确定 K 线请求时间");
    }
    endAt = Math.trunc(endAt);
  } else {
    if (!Number.isSafeInteger(before) || before <= 0 || !Number.isFinite(new Date(before).getTime())) {
      throw new CandleHistoryError("invalid-time", "K 线历史分页时间无效");
    }
    // Providers may include their end boundary; the next page must not repeat it.
    endAt = before - 1;
  }
  if (!Number.isSafeInteger(endAt) || !Number.isFinite(new Date(endAt).getTime())) {
    throw new CandleHistoryError("invalid-time", "K 线请求时间超出支持范围");
  }
  const currentBucketStart = Math.floor(endAt / durationMs) * durationMs;
  const rawStartAt = currentBucketStart - ((CANDLE_HISTORY_LIMIT - 1) * durationMs);
  if (!Number.isSafeInteger(rawStartAt) || (before === undefined && rawStartAt <= 0)) {
    throw new CandleHistoryError("invalid-time", "K 线请求时间超出支持范围");
  }
  return { startAt: Math.max(0, rawStartAt), endAt };
}

function requestUrl(
  target: CandleTarget,
  config: Readonly<IntervalConfig>,
  window: RequestWindow,
): string {
  if (target.source === "coinbase") {
    return `${COINBASE_API_ROOT}/${encodeURIComponent(target.symbol)}/candles`
      + `?granularity=${config.coinbase}`
      + `&start=${encodeURIComponent(new Date(window.startAt).toISOString())}`
      + `&end=${encodeURIComponent(new Date(window.endAt).toISOString())}`;
  }
  if (target.source === "bybit") {
    return `${BYBIT_API_ROOT}/kline?category=linear`
      + `&symbol=${encodeURIComponent(target.symbol)}`
      + `&interval=${config.bybit}`
      + `&start=${window.startAt}`
      + `&end=${window.endAt}`
      + `&limit=${CANDLE_HISTORY_LIMIT}`;
  }
  return `${GATE_API_ROOT}/candlesticks?contract=${encodeURIComponent(target.symbol)}`
    + `&interval=${config.gate}`
    + `&from=${Math.floor(window.startAt / 1_000)}`
    + `&to=${Math.floor(window.endAt / 1_000)}`;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedOpenTime(value: unknown, multiplier: number): number | null {
  const number = finiteNumber(value);
  if (number === null || number <= 0) return null;
  const openTime = Math.trunc(number * multiplier);
  return Number.isSafeInteger(openTime) && openTime > 0 ? openTime : null;
}

function parseCandle(
  openTimeValue: unknown,
  multiplier: number,
  openValue: unknown,
  highValue: unknown,
  lowValue: unknown,
  closeValue: unknown,
): Candle | null {
  const openTime = normalizedOpenTime(openTimeValue, multiplier);
  const open = finiteNumber(openValue);
  const high = finiteNumber(highValue);
  const low = finiteNumber(lowValue);
  const close = finiteNumber(closeValue);
  if (
    openTime === null
    || open === null
    || high === null
    || low === null
    || close === null
    || open <= 0
    || high <= 0
    || low <= 0
    || close <= 0
    || high < low
    || high < Math.max(open, close)
    || low > Math.min(open, close)
  ) return null;
  return { openTime, open, high, low, close };
}

function parseCoinbasePayload(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) {
    throw new CandleHistoryError("malformed-response", "Coinbase K 线响应格式无效");
  }
  return payload.map((row) => (
    Array.isArray(row)
      ? parseCandle(row[0], 1_000, row[3], row[2], row[1], row[4])
      : null
  )).filter((candle): candle is Candle => candle !== null);
}

function parseBybitPayload(payload: unknown, expectedSymbol: string): Candle[] {
  if (!payload || typeof payload !== "object") {
    throw new CandleHistoryError("malformed-response", "Bybit K 线响应格式无效");
  }
  const value = payload as Record<string, unknown>;
  if (value.retCode !== 0) {
    throw new CandleHistoryError("provider", "Bybit 拒绝了 K 线请求");
  }
  const result = value.result;
  if (!result || typeof result !== "object") {
    throw new CandleHistoryError("malformed-response", "Bybit K 线响应格式无效");
  }
  const resultRecord = result as Record<string, unknown>;
  if (
    typeof resultRecord.symbol === "string"
    && resultRecord.symbol !== expectedSymbol
  ) {
    throw new CandleHistoryError("malformed-response", "Bybit K 线响应标的与请求不一致");
  }
  if (!Array.isArray(resultRecord.list)) {
    throw new CandleHistoryError("malformed-response", "Bybit K 线响应格式无效");
  }
  return resultRecord.list.map((row) => (
    Array.isArray(row)
      ? parseCandle(row[0], 1, row[1], row[2], row[3], row[4])
      : null
  )).filter((candle): candle is Candle => candle !== null);
}

function parseGatePayload(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) {
    throw new CandleHistoryError("malformed-response", "Gate K 线响应格式无效");
  }
  return payload.map((row) => {
    if (!row || typeof row !== "object") return null;
    const candle = row as Record<string, unknown>;
    return parseCandle(candle.t, 1_000, candle.o, candle.h, candle.l, candle.c);
  }).filter((candle): candle is Candle => candle !== null);
}

function normalizeCandles(
  source: CandleSource,
  payload: unknown,
  expectedSymbol: string,
  window: RequestWindow,
): Candle[] {
  const rawLength = source === "bybit"
    ? (payload as { result?: { list?: unknown } } | null)?.result?.list
    : payload;
  const rows = Array.isArray(rawLength) ? rawLength.length : 0;
  const parsed = source === "coinbase"
    ? parseCoinbasePayload(payload)
    : source === "bybit"
      ? parseBybitPayload(payload, expectedSymbol)
      : parseGatePayload(payload);
  if (rows > 0 && parsed.length === 0) {
    throw new CandleHistoryError("malformed-response", "K 线响应中没有有效数据");
  }

  const seen = new Set<number>();
  const normalized: Candle[] = [];
  for (const candle of parsed) {
    if (
      candle.openTime < window.startAt
      || candle.openTime > window.endAt
      || seen.has(candle.openTime)
    ) continue;
    seen.add(candle.openTime);
    normalized.push(candle);
  }
  normalized.sort((left, right) => left.openTime - right.openTime);
  return normalized.slice(-CANDLE_HISTORY_LIMIT);
}

function abortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveFetch(fetchImpl: FetchImpl | null | undefined): FetchImpl {
  if (fetchImpl !== undefined) {
    if (typeof fetchImpl !== "function") {
      throw new CandleHistoryError("fetch-unavailable", "当前环境无法请求 K 线数据");
    }
    return fetchImpl;
  }
  if (typeof globalThis.fetch !== "function") {
    throw new CandleHistoryError("fetch-unavailable", "当前环境无法请求 K 线数据");
  }
  return globalThis.fetch.bind(globalThis) as FetchImpl;
}

export async function fetchCandleHistoryPage({
  product,
  marketSource,
  interval,
  fetchImpl,
  now = () => Date.now(),
  signal,
  before,
}: FetchCandleHistoryPageOptions): Promise<CandleHistoryPage> {
  const target = resolveTarget(product, marketSource);
  const config = intervalConfig(interval);
  const window = requestWindow(now, config.durationMs, before);
  const fetcher = resolveFetch(fetchImpl);
  if (signal?.aborted) throw abortError();

  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = (): void => controller.abort();
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(requestUrl(target, config, window), {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (controller.signal.aborted) throw abortError();
    if (!response || typeof response !== "object" || typeof response.json !== "function") {
      throw new CandleHistoryError("malformed-response", "K 线 HTTP 响应格式无效");
    }
    if (!response.ok) {
      const status = Number.isFinite(response.status) ? response.status as number : null;
      throw new CandleHistoryError("http", `K 线请求失败${status === null ? "" : ` (${status})`}`, status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new CandleHistoryError("malformed-response", "K 线响应不是有效 JSON");
    }
    if (controller.signal.aborted) throw abortError();
    return {
      candles: normalizeCandles(target.source, payload, target.symbol, window),
      nextBefore: window.startAt,
    };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) {
      throw new CandleHistoryError("timeout", "K 线请求超时");
    }
    if (isAbortError(error)) throw error;
    if (error instanceof CandleHistoryError) throw error;
    throw new CandleHistoryError("network", "无法连接 K 线数据源");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export async function fetchCandleHistory(options: FetchCandleHistoryOptions): Promise<Candle[]> {
  return (await fetchCandleHistoryPage(options)).candles;
}
