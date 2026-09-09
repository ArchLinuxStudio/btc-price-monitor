import { CandleHistoryError } from "./candle-history.js";
import type { Candle, CandleHistoryPage, CandleInterval } from "./candle-history.js";
import type { ChartCurrentPriceState } from "./chart-current-price.js";
import type { MarketSource, Quote } from "./price-feed.js";

export interface ChartLiveCandlesState {
  price: number | null;
  stale: boolean;
  syncing: boolean;
}

export interface ChartLiveCandlesOptions {
  interval: CandleInterval;
  productId: string;
  marketSource: MarketSource;
  snapshotStartedAt: number;
  getCandles: () => readonly Candle[];
  mergeCandles: (recent: readonly Candle[]) => void;
  loadRecent: (signal: AbortSignal) => Promise<CandleHistoryPage>;
  onChange: () => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => () => void;
}

const DURATIONS: Record<CandleInterval, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000,
};
const REFRESH_INTERVAL = 30_000;
const MIN_REQUEST_INTERVAL = 5_000;
const REQUEST_TIMEOUT = 8_000;

interface TickRange {
  high: number;
  low: number;
  close: number;
}

interface TailRequest {
  controller: AbortController;
  revision: number;
  startedAt: number;
  replay: Map<number, TickRange>;
  cancelTimeout: () => void;
}

/** Update real candle buckets and derive their guide from the same last close. */
export class ChartLiveCandles {
  private readonly options: ChartLiveCandlesOptions;
  private readonly duration: number;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delay: number) => () => void;
  private active = false;
  private revision = 0;
  private quote: Quote | null = null;
  private quoteStale = true;
  private seenQuote = false;
  private eventWatermark = 0;
  private snapshotStartedAt: number;
  private lastRefreshAt: number;
  private nextRequestAt = 0;
  private refreshNeeded = false;
  private request: TailRequest | null = null;
  private cancelTick: (() => void) | null = null;
  private previousState: ChartLiveCandlesState | null = null;

  constructor(options: ChartLiveCandlesOptions) {
    this.options = options;
    this.duration = DURATIONS[options.interval];
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? ((callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    });
    this.snapshotStartedAt = options.snapshotStartedAt;
    this.lastRefreshAt = options.snapshotStartedAt;
  }

  get state(): ChartLiveCandlesState {
    const last = this.options.getCandles().at(-1);
    const price = this.active && this.quote && last ? last.close : null;
    return {
      price,
      stale: price === null || this.quoteStale,
      syncing: this.active && (this.refreshNeeded || this.request !== null),
    };
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.revision += 1;
    this.checkRefresh();
    this.notify();
    this.scheduleTick();
  }

  stop(): void {
    this.active = false;
    this.revision += 1;
    this.cancelTick?.();
    this.cancelTick = null;
    const request = this.request;
    this.request = null;
    request?.cancelTimeout();
    request?.controller.abort();
    this.quote = null;
    this.quoteStale = true;
    this.seenQuote = false;
    this.eventWatermark = 0;
    this.refreshNeeded = false;
    this.notify();
  }

  setQuote(state: ChartCurrentPriceState): void {
    if (!this.active) return;
    const quote = state.quote;
    if (!quote) {
      this.quote = null;
      this.quoteStale = true;
      this.notify();
      return;
    }
    if (quote.asset !== this.options.productId || quote.marketSource !== this.options.marketSource
      || !Number.isFinite(quote.price) || quote.price <= 0
      || !Number.isSafeInteger(quote.exchangeAt) || quote.exchangeAt <= 0
      || !Number.isSafeInteger(quote.receivedAt) || quote.receivedAt <= 0) return;
    if (quote.exchangeAt < this.eventWatermark) {
      if (state.stale) this.quoteStale = true;
      this.notify();
      return;
    }
    const recovered = this.seenQuote && this.quoteStale && !state.stale;
    this.quote = { ...quote };
    this.quoteStale = state.stale;
    this.seenQuote = true;
    this.eventWatermark = quote.exchangeAt;
    let changed = false;
    if (!state.stale && quote.exchangeAt >= this.snapshotStartedAt) {
      const bucket = this.bucket(quote.exchangeAt);
      const request = this.request;
      if (request && quote.exchangeAt >= request.startedAt) {
        const range = request.replay.get(bucket);
        request.replay.set(bucket, {
          high: Math.max(range?.high ?? quote.price, quote.price),
          low: Math.min(range?.low ?? quote.price, quote.price),
          close: quote.price,
        });
        // An eight-second request normally crosses at most two one-minute buckets.
        // Keep this bounded even if the provider's clock jumps unexpectedly.
        while (request.replay.size > 4) request.replay.delete(request.replay.keys().next().value!);
      }
      const last = this.options.getCandles().at(-1);
      if (last && bucket === last.openTime) {
        const updated = this.applyRange(last, { high: quote.price, low: quote.price, close: quote.price });
        if (!this.sameCandle(last, updated)) {
          this.options.mergeCandles([updated]);
          changed = true;
        }
      } else if (!last || bucket > last.openTime) this.refreshNeeded = true;
    }
    if (recovered) this.refreshNeeded = true;
    this.checkRefresh();
    this.notify(changed);
  }

  private bucket(timestamp: number): number {
    return Math.floor(timestamp / this.duration) * this.duration;
  }

  private applyRange(candle: Candle, range: TickRange): Candle {
    return {
      ...candle,
      high: Math.max(candle.high, range.high),
      low: Math.min(candle.low, range.low),
      close: range.close,
    };
  }

  private sameCandle(left: Candle, right: Candle): boolean {
    return left.openTime === right.openTime && left.open === right.open && left.high === right.high
      && left.low === right.low && left.close === right.close;
  }

  private missingCurrentBucket(): boolean {
    const last = this.options.getCandles().at(-1);
    const expected = Math.max(this.bucket(this.now()),
      this.quote && !this.quoteStale ? this.bucket(this.quote.exchangeAt) : 0);
    return !!last && expected > last.openTime;
  }

  private checkRefresh(): void {
    if (!this.active) return;
    if (this.missingCurrentBucket() || this.now() - this.lastRefreshAt >= REFRESH_INTERVAL) {
      this.refreshNeeded = true;
    }
    if (this.refreshNeeded && !this.request && this.now() >= this.nextRequestAt) void this.refresh();
  }

  private scheduleTick(): void {
    if (!this.active) return;
    this.cancelTick = this.schedule(() => {
      this.cancelTick = null;
      if (!this.active) return;
      this.checkRefresh();
      this.notify();
      this.scheduleTick();
    }, 1_000);
  }

  private current(request: TailRequest): boolean {
    return this.active && this.request === request && this.revision === request.revision
      && !request.controller.signal.aborted;
  }

  private async refresh(): Promise<void> {
    const request: TailRequest = {
      controller: new AbortController(), revision: this.revision, startedAt: this.now(),
      replay: new Map(), cancelTimeout: () => {},
    };
    // A rollover/recovery tick can itself initiate this request. Preserve that
    // event too when it is at least as recent as the new snapshot's start.
    const quote = this.quote;
    if (quote && !this.quoteStale && quote.exchangeAt >= request.startedAt
      && quote.exchangeAt >= this.snapshotStartedAt) {
      request.replay.set(this.bucket(quote.exchangeAt), {
        high: quote.price, low: quote.price, close: quote.price,
      });
    }
    this.request = request;
    this.nextRequestAt = request.startedAt + MIN_REQUEST_INTERVAL;
    request.cancelTimeout = this.schedule(() => {
      if (!this.current(request)) return;
      this.request = null;
      request.controller.abort();
      this.refreshNeeded = true;
      this.notify();
    }, REQUEST_TIMEOUT);
    this.notify();
    try {
      const page = await this.options.loadRecent(request.controller.signal);
      if (!this.current(request)) return;
      if (page.candles.length > 0) {
        const recent = new Map(page.candles.map((candle) => [candle.openTime, candle]));
        const retained = this.options.getCandles();
        for (const [bucket, range] of request.replay) {
          const actual = recent.get(bucket) ?? retained.find((candle) => candle.openTime === bucket);
          if (actual) recent.set(bucket, this.applyRange(actual, range));
        }
        this.options.mergeCandles([...recent.values()].sort((a, b) => a.openTime - b.openTime));
        this.snapshotStartedAt = Math.max(this.snapshotStartedAt, request.startedAt);
        this.lastRefreshAt = this.now();
        this.refreshNeeded = this.missingCurrentBucket();
      } else this.refreshNeeded = true;
    } catch (error) {
      if (!this.current(request)) return;
      this.refreshNeeded = true;
      const cooldown = error instanceof CandleHistoryError
        ? error.status === 403 ? 600_000 : error.status === 429 ? 60_000 : 0
        : 0;
      this.nextRequestAt = Math.max(this.nextRequestAt, this.now() + cooldown);
    } finally {
      request.cancelTimeout();
      if (this.request === request) {
        this.request = null;
        this.notify(true);
      }
    }
  }

  private notify(force = false): void {
    const state = this.state;
    const previous = this.previousState;
    if (!force && previous && state.price === previous.price && state.stale === previous.stale
      && state.syncing === previous.syncing) return;
    this.previousState = state;
    this.options.onChange();
  }
}
