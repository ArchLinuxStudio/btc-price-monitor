import { CandleHistoryError } from "./candle-history.js";
import type { Candle, CandleHistoryPage } from "./candle-history.js";
import {
  DEFAULT_VISIBLE_CANDLES,
  MIN_VISIBLE_CANDLES,
  createCandleViewport,
  normalizeCandleViewport,
} from "./chart-viewport.js";
import type { CandleViewport } from "./chart-viewport.js";

export const MAX_HISTORY_CANDLES = 4_800;
const MAX_PAGES_PER_BATCH = 4;
const PREFETCH_BUFFER_CANDLES = 480;
const PREFETCH_DELAY_MS = 1_000;

function schedule(callback: () => void, delay: number): () => void {
  const timer = setTimeout(callback, delay);
  return () => clearTimeout(timer);
}

interface ChartNavigationOptions {
  readonly loadPage: (before: number, signal: AbortSignal) => Promise<CandleHistoryPage>;
  /** Loaded indices shift on prepend (positive) or oldest-cache eviction (negative). */
  readonly onChange: (indexShift: number) => void;
  readonly schedule?: (callback: () => void, delay: number) => () => void;
  readonly now?: () => number;
}

/** Owns a loaded series and the user's viewport intent while older pages arrive. */
export class ChartNavigation {
  private candleData: Candle[];
  private desiredViewport: CandleViewport;
  private pendingZoomViewport: CandleViewport | null = null;
  private pendingZoomAnchor = 1;
  private nextBefore: number;
  private historyComplete = false;
  private oldestRetained = true;
  private olderLoading = false;
  private demandPaused = false;
  private message = "";
  private cancelled = false;
  private revision = 0;
  private controller: AbortController | null = null;
  private prefetchEnabled = false;
  private prefetchPaused = false;
  private prefetchPages = 0;
  private cancelPrefetchTimer: (() => void) | null = null;
  private blockedUntil = 0;
  private readonly options: ChartNavigationOptions;

  constructor(initialPage: CandleHistoryPage, options: ChartNavigationOptions) {
    this.options = options;
    this.candleData = initialPage.candles.slice(-MAX_HISTORY_CANDLES);
    this.desiredViewport = createCandleViewport(this.candleData.length);
    this.nextBefore = initialPage.nextBefore;
    this.historyComplete = initialPage.historyComplete === true
      || (initialPage.historyComplete !== false && initialPage.nextBefore === 0);
    this.oldestRetained = initialPage.candles.length <= MAX_HISTORY_CANDLES;
    this.acceptRetryDelay(initialPage);
    this.updateBoundaryMessage();
  }

  get candles(): Candle[] {
    return this.candleData;
  }

  /** Pan may include blank space; an unfinished larger zoom has separate intent. */
  get viewport(): CandleViewport {
    return normalizeCandleViewport(this.desiredViewport, this.candleData.length);
  }

  get loadingOlder(): boolean {
    return this.olderLoading;
  }

  get canLoadOlder(): boolean {
    return !this.cancelled && !this.historyComplete && this.candleData.length < MAX_HISTORY_CANDLES
      && Number.isSafeInteger(this.nextBefore) && this.nextBefore > 0;
  }

  /** A page edge or cache limit alone never establishes the actual origin. */
  get historyStartReached(): boolean {
    return this.historyComplete && this.oldestRetained && this.candleData.length > 0;
  }

  get historyMessage(): string {
    if (this.needsOlder && this.isCoolingDown) {
      return "数据源请求受限，已暂停历史加载；请稍后重试";
    }
    return this.message;
  }

  get needsOlder(): boolean {
    return this.canLoadOlder
      && (this.pendingZoomViewport !== null || this.desiredViewport.start < -1e-8);
  }

  /** Call after the owner has installed this instance and shown its first page. */
  startPrefetch(): void {
    if (this.cancelled) return;
    this.prefetchEnabled = true;
    this.schedulePrefetch();
  }

  zoom(scale: number, anchor?: number): void {
    if (this.cancelled || this.candleData.length === 0 || Number.isNaN(scale) || scale <= 0) return;
    // Repeated zoom-out retains pending demand; reversing direction must enlarge
    // the candles currently on screen instead of shrinking an unseen target.
    const current = scale > 1 ? this.viewport : this.pendingZoomViewport ?? this.viewport;
    const atLatestBoundary = Math.abs(current.start + current.count - this.candleData.length) < 1e-8;
    const requestedAnchor = anchor ?? (atLatestBoundary ? 1 : 0.5);
    const ratio = Number.isNaN(requestedAnchor) ? 0.5 : Math.min(1, Math.max(0, requestedAnchor));
    const minimum = Math.min(MIN_VISIBLE_CANDLES, this.candleData.length);
    const maximum = this.canLoadOlder ? MAX_HISTORY_CANDLES : this.candleData.length;
    const count = Math.min(maximum, Math.max(minimum, current.count / scale));
    this.changeIntent({
      start: current.start + current.count * ratio - count * ratio,
      count,
    }, ratio);
  }

  pan(delta: number): void {
    if (this.cancelled || this.candleData.length === 0 || Number.isNaN(delta) || delta === 0) return;
    if (delta === Number.POSITIVE_INFINITY) {
      const count = this.viewport.count;
      this.changeIntent({ start: this.candleData.length - count, count });
      return;
    }
    const current = this.viewport;
    this.changeIntent({ start: current.start + delta, count: current.count });
  }

  setViewport(viewport: CandleViewport): void {
    if (this.cancelled) return;
    this.changeIntent(viewport);
  }

  reset(): void {
    if (this.cancelled) return;
    this.pendingZoomViewport = null;
    this.demandPaused = false;
    this.desiredViewport = createCandleViewport(this.candleData.length);
    this.message = "";
    this.updateBoundaryMessage();
    this.options.onChange(0);
    this.schedulePrefetch();
  }

  continueLoading(): void {
    this.continueDemand(true);
  }

  /** Applies an already reconciled same-source tail without changing the older cursor. */
  mergeRecentCandles(recent: readonly Candle[], followLatest = true): void {
    if (this.cancelled || recent.length === 0) return;
    const previousTotal = this.candleData.length;
    const latestTime = this.candleData.at(-1)?.openTime ?? Number.NEGATIVE_INFINITY;
    const byTime = new Map(recent.map((candle) => [candle.openTime, candle]));
    let changed = false;
    const updated = this.candleData.map((current) => {
      const next = byTime.get(current.openTime);
      if (!next || (next.open === current.open && next.high === current.high
        && next.low === current.low && next.close === current.close)) return current;
      changed = true;
      return { ...next };
    });
    // A tail refresh repairs known buckets and advances the right edge. It must
    // not backfill holes or move the left boundary behind pagination's cursor.
    const appended = [...byTime.values()].filter((candle) => candle.openTime > latestTime)
      .sort((a, b) => a.openTime - b.openTime).map((candle) => ({ ...candle }));
    if (!changed && appended.length === 0) return;

    const previous = this.viewport;
    const followsLatest = followLatest && this.pendingZoomViewport === null
      && Math.abs(previous.start + previous.count - previousTotal) < 1e-8;
    const evicted = Math.max(0, previousTotal + appended.length - MAX_HISTORY_CANDLES);
    this.candleData = [...updated, ...appended].slice(-MAX_HISTORY_CANDLES);
    if (evicted > 0) this.oldestRetained = false;

    if (this.pendingZoomViewport !== null) {
      const pending = {
        start: this.pendingZoomViewport.start - evicted,
        count: this.pendingZoomViewport.count,
      };
      if (pending.count <= this.candleData.length || !this.canLoadOlder) {
        this.pendingZoomViewport = null;
        this.desiredViewport = normalizeCandleViewport(pending, this.candleData.length);
      } else {
        this.pendingZoomViewport = pending;
        this.desiredViewport = this.availableZoomViewport(pending);
      }
    } else if (previousTotal === 0) {
      this.desiredViewport = createCandleViewport(this.candleData.length);
    } else {
      this.desiredViewport = normalizeCandleViewport({
        start: previous.start - evicted,
        count: previous.count,
      }, this.candleData.length);
      if (followsLatest) {
        this.desiredViewport = {
          start: this.candleData.length - this.desiredViewport.count,
          count: this.desiredViewport.count,
        };
      }
    }
    this.updateBoundaryMessage();
    this.options.onChange(evicted === 0 ? 0 : -evicted);
    this.schedulePrefetch();
  }

  private continueDemand(explicit: boolean): void {
    if (this.cancelled || this.olderLoading) return;
    if (this.candleData.length === 0 && this.canLoadOlder && this.desiredViewport.count === 0) {
      this.pendingZoomViewport = { start: -DEFAULT_VISIBLE_CANDLES, count: DEFAULT_VISIBLE_CANDLES };
    }
    if (!this.needsOlder) {
      this.demandPaused = false;
      this.schedulePrefetch();
      return;
    }
    this.clearPrefetchTimer();
    if (this.isCoolingDown) {
      this.options.onChange(0);
      return;
    }
    if (this.demandPaused && !explicit) return;
    this.demandPaused = false;
    void this.loadOlderBatch();
  }

  /** Invalidates even a fetch implementation that resolves after abort. */
  cancel(): void {
    this.cancelled = true;
    this.revision += 1;
    this.clearPrefetchTimer();
    this.controller?.abort();
    this.controller = null;
    this.olderLoading = false;
  }

  private changeIntent(requested: CandleViewport, zoomAnchor?: number): void {
    const total = this.candleData.length;
    if (zoomAnchor !== undefined && this.canLoadOlder && requested.count > total) {
      this.pendingZoomViewport = {
        start: Math.min(total - 1, Math.max(1 - requested.count, requested.start)),
        count: requested.count,
      };
      this.pendingZoomAnchor = zoomAnchor;
      // Preserve the established progressive zoom-out behavior until the
      // requested scale is available, keeping the same pointer/time anchor even
      // when the user zooms while looking into blank space.
      this.desiredViewport = this.availableZoomViewport(this.pendingZoomViewport);
    } else {
      this.pendingZoomViewport = null;
      this.desiredViewport = normalizeCandleViewport(requested, total);
    }
    if (!this.needsOlder) {
      this.demandPaused = false;
      this.message = "";
    } else if (this.olderLoading) {
      this.message = "正在加载更早 K 线…";
    } else if (!this.demandPaused) {
      this.message = "";
    }
    this.updateBoundaryMessage();
    this.options.onChange(0);
    this.continueDemand(false);
  }

  private updateBoundaryMessage(): void {
    if (this.historyStartReached) {
      this.message = "已到达历史起点";
    } else if (this.historyComplete && this.candleData.length === 0) {
      this.message = "该数据源暂无可查询的历史 K 线";
    } else if (this.candleData.length >= MAX_HISTORY_CANDLES) {
      this.message = `已达到当前图表 ${MAX_HISTORY_CANDLES} 根历史上限`;
    } else if (this.nextBefore === 0) {
      this.message = "已到达查询时间边界，历史起点尚未确认";
    }
  }

  private availableZoomViewport(pending: CandleViewport): CandleViewport {
    const total = this.candleData.length;
    return normalizeCandleViewport({
      start: pending.start + (pending.count - total) * this.pendingZoomAnchor,
      count: total,
    }, total);
  }

  private get isCoolingDown(): boolean {
    return (this.options.now ?? Date.now)() < this.blockedUntil;
  }

  private acceptRetryDelay(page: CandleHistoryPage): void {
    if (page.olderRetryAfterMs === 60_000 || page.olderRetryAfterMs === 600_000) {
      this.blockedUntil = Math.max(this.blockedUntil,
        (this.options.now ?? Date.now)() + page.olderRetryAfterMs);
    }
  }

  private get needsPrefetch(): boolean {
    return this.prefetchEnabled && !this.prefetchPaused && this.canLoadOlder
      && this.candleData.length > 0 && !this.needsOlder && !this.isCoolingDown
      && this.viewport.start < PREFETCH_BUFFER_CANDLES;
  }

  private clearPrefetchTimer(): void {
    this.cancelPrefetchTimer?.();
    this.cancelPrefetchTimer = null;
  }

  private schedulePrefetch(): void {
    if (this.viewport.start >= PREFETCH_BUFFER_CANDLES) this.prefetchPages = 0;
    if (!this.needsPrefetch) {
      this.clearPrefetchTimer();
      return;
    }
    if (this.olderLoading || this.cancelPrefetchTimer !== null) return;
    this.cancelPrefetchTimer = (this.options.schedule ?? schedule)(() => {
      this.cancelPrefetchTimer = null;
      if (this.needsPrefetch && !this.olderLoading) void this.loadOlderBatch(true);
    }, PREFETCH_DELAY_MS);
  }

  private prependPage(page: CandleHistoryPage): number {
    const earliest = this.candleData[0]?.openTime ?? Number.POSITIVE_INFINITY;
    const unique = new Map<number, Candle>();
    for (const candle of page.candles) {
      if (candle.openTime < earliest) unique.set(candle.openTime, candle);
    }
    const room = MAX_HISTORY_CANDLES - this.candleData.length;
    if (unique.size > room) this.oldestRetained = false;
    // A live tail can fill the cache while an older request is in flight.
    if (room <= 0) return 0;
    const older = [...unique.values()].sort((a, b) => a.openTime - b.openTime).slice(-room);
    if (older.length === 0) return 0;
    this.candleData = [...older, ...this.candleData];
    this.desiredViewport = {
      start: this.desiredViewport.start + older.length,
      count: this.desiredViewport.count,
    };
    if (this.pendingZoomViewport !== null) {
      const pending = {
        start: this.pendingZoomViewport.start + older.length,
        count: this.pendingZoomViewport.count,
      };
      if (pending.count <= this.candleData.length) {
        this.pendingZoomViewport = null;
        this.desiredViewport = normalizeCandleViewport(pending, this.candleData.length);
      } else {
        this.pendingZoomViewport = pending;
        this.desiredViewport = this.availableZoomViewport(pending);
      }
    }
    return older.length;
  }

  private async loadOlderBatch(prefetch = false): Promise<void> {
    const revision = this.revision;
    const controller = new AbortController();
    this.controller = controller;
    this.olderLoading = true;
    this.message = this.needsOlder ? "正在加载更早 K 线…" : "";
    this.options.onChange(0);

    try {
      for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_BATCH; pageNumber += 1) {
        if (this.isCoolingDown) break;
        if (!this.needsOlder && !(prefetch && pageNumber === 0 && this.needsPrefetch)) break;
        const startedForDemand = this.needsOlder;
        const before = this.nextBefore;
        const page = await this.options.loadPage(before, controller.signal);
        if (this.cancelled || revision !== this.revision || controller.signal.aborted) return;
        if (!Number.isSafeInteger(page.nextBefore) || page.nextBefore < 0
          || page.nextBefore > before || (page.nextBefore === before && page.historyComplete !== true)) {
          this.prefetchPaused = true;
          this.message = this.needsOlder ? "数据源未返回更早的时间范围，可重试加载" : "";
          break;
        }
        const satisfiedDemand = startedForDemand || this.needsOlder;
        this.nextBefore = page.nextBefore;
        this.acceptRetryDelay(page);
        this.historyComplete = page.historyComplete === true
          || (page.historyComplete !== false && page.nextBefore === 0);
        const prepended = this.prependPage(page);
        if (prepended === 0) {
          this.prefetchPaused = true;
        } else if (satisfiedDemand) {
          this.prefetchPaused = false;
          this.prefetchPages = 0;
        } else {
          this.prefetchPages += 1;
          if (this.prefetchPages >= MAX_PAGES_PER_BATCH && this.viewport.start < PREFETCH_BUFFER_CANDLES) {
            this.prefetchPaused = true;
          }
        }
        if (this.needsOlder) this.message = "正在加载更早 K 线…";
        if (!this.canLoadOlder) {
          this.pendingZoomViewport = null;
          this.desiredViewport = this.viewport;
        }
        this.updateBoundaryMessage();
        this.options.onChange(prepended);
      }
      if (this.needsOlder && this.message === "正在加载更早 K 线…") {
        this.message = "尚未确认历史起点，可继续查询";
      } else if (!this.needsOlder && this.message === "正在加载更早 K 线…") {
        this.message = "";
      }
    } catch (error) {
      if (this.cancelled || revision !== this.revision || controller.signal.aborted) return;
      this.prefetchPaused = true;
      if (error instanceof CandleHistoryError && (error.status === 429 || error.status === 403)) {
        this.blockedUntil = (this.options.now ?? Date.now)() + (error.status === 403 ? 600_000 : 60_000);
      }
      if (!this.needsOlder) {
        this.message = "";
        this.updateBoundaryMessage();
      } else if (error instanceof CandleHistoryError && error.code === "invalid-time") {
        this.nextBefore = Number.NaN;
        this.pendingZoomViewport = null;
        this.desiredViewport = this.viewport;
        this.message = "历史查询时间无效，已暂停加载";
      } else {
        this.message = "更早 K 线加载失败，已保留当前图表；可重试";
      }
    } finally {
      if (!this.cancelled && revision === this.revision) {
        this.controller = null;
        this.olderLoading = false;
        // Pointer moves keep updating the same held drag. They must not turn a
        // failed cursor or an exhausted four-page batch into a retry loop.
        this.demandPaused = this.needsOlder;
        this.options.onChange(0);
        this.schedulePrefetch();
      }
    }
  }
}
