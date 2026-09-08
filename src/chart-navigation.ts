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
  readonly onChange: (prepended: number) => void;
  readonly schedule?: (callback: () => void, delay: number) => () => void;
  readonly now?: () => number;
}

/** Owns a loaded series and the user's viewport intent while older pages arrive. */
export class ChartNavigation {
  private candleData: Candle[];
  private desiredViewport: CandleViewport;
  private nextBefore: number;
  private olderLoading = false;
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
    this.updateBoundaryMessage();
  }

  get candles(): Candle[] {
    return this.candleData;
  }

  /** Rendering is always limited to real loaded candles; intent may extend left. */
  get viewport(): CandleViewport {
    return normalizeCandleViewport(this.desiredViewport, this.candleData.length);
  }

  get loadingOlder(): boolean {
    return this.olderLoading;
  }

  get canLoadOlder(): boolean {
    return !this.cancelled && this.candleData.length < MAX_HISTORY_CANDLES
      && Number.isSafeInteger(this.nextBefore) && this.nextBefore > 0;
  }

  get historyMessage(): string {
    if (this.needsOlder && this.isCoolingDown) {
      return "数据源请求受限，已暂停历史加载；请稍后重试";
    }
    return this.message;
  }

  get needsOlder(): boolean {
    return this.canLoadOlder && this.desiredViewport.start < -1e-8;
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
    const current = scale > 1 ? this.viewport : this.desiredViewport;
    const atLatestBoundary = Math.abs(current.start + current.count - this.candleData.length) < 1e-8;
    const requestedAnchor = anchor ?? (atLatestBoundary ? 1 : 0.5);
    const ratio = Number.isNaN(requestedAnchor) ? 0.5 : Math.min(1, Math.max(0, requestedAnchor));
    const minimum = Math.min(MIN_VISIBLE_CANDLES, this.candleData.length);
    const count = Math.min(MAX_HISTORY_CANDLES, Math.max(minimum, current.count / scale));
    this.changeIntent({
      start: current.start + current.count * ratio - count * ratio,
      count,
    });
  }

  pan(delta: number): void {
    if (this.cancelled || this.candleData.length === 0 || Number.isNaN(delta) || delta === 0) return;
    if (delta === Number.POSITIVE_INFINITY) {
      const count = this.viewport.count;
      this.changeIntent({ start: this.candleData.length - count, count });
      return;
    }
    this.changeIntent({ start: this.desiredViewport.start + delta, count: this.desiredViewport.count });
  }

  setViewport(viewport: CandleViewport): void {
    if (this.cancelled) return;
    this.changeIntent(viewport);
  }

  reset(): void {
    if (this.cancelled) return;
    this.desiredViewport = createCandleViewport(this.candleData.length);
    this.message = "";
    this.updateBoundaryMessage();
    this.options.onChange(0);
    this.schedulePrefetch();
  }

  continueLoading(): void {
    if (this.cancelled || this.olderLoading) return;
    if (this.candleData.length === 0 && this.canLoadOlder && this.desiredViewport.count === 0) {
      this.desiredViewport = { start: -DEFAULT_VISIBLE_CANDLES, count: DEFAULT_VISIBLE_CANDLES };
    }
    if (!this.needsOlder) {
      this.schedulePrefetch();
      return;
    }
    this.clearPrefetchTimer();
    if (this.isCoolingDown) {
      this.options.onChange(0);
      return;
    }
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

  private changeIntent(requested: CandleViewport): void {
    const total = this.candleData.length;
    if (!this.canLoadOlder) {
      this.desiredViewport = normalizeCandleViewport(requested, total);
    } else {
      const minimum = Math.min(MIN_VISIBLE_CANDLES, total);
      const count = Number.isNaN(requested.count) ? this.viewport.count
        : Math.min(MAX_HISTORY_CANDLES, Math.max(minimum, requested.count));
      const start = Number.isNaN(requested.start) ? this.viewport.start : requested.start;
      this.desiredViewport = {
        start: Math.min(total - count, Math.max(total - MAX_HISTORY_CANDLES, start)),
        count,
      };
    }
    this.message = this.olderLoading && this.needsOlder ? "正在加载更早 K 线…" : "";
    this.updateBoundaryMessage();
    this.options.onChange(0);
    this.continueLoading();
  }

  private updateBoundaryMessage(): void {
    if (this.candleData.length >= MAX_HISTORY_CANDLES) {
      this.message = `已达到当前图表 ${MAX_HISTORY_CANDLES} 根历史上限`;
    } else if (this.nextBefore === 0) {
      this.message = "已到达可查询的历史时间边界";
    }
  }

  private get isCoolingDown(): boolean {
    return (this.options.now ?? Date.now)() < this.blockedUntil;
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
    const older = [...unique.values()].sort((a, b) => a.openTime - b.openTime).slice(-room);
    if (older.length === 0) return 0;
    this.candleData = [...older, ...this.candleData];
    this.desiredViewport = {
      start: this.desiredViewport.start + older.length,
      count: this.desiredViewport.count,
    };
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
        if (!this.needsOlder && !(prefetch && pageNumber === 0 && this.needsPrefetch)) break;
        const startedForDemand = this.needsOlder;
        const before = this.nextBefore;
        const page = await this.options.loadPage(before, controller.signal);
        if (this.cancelled || revision !== this.revision || controller.signal.aborted) return;
        if (!Number.isSafeInteger(page.nextBefore) || page.nextBefore < 0 || page.nextBefore >= before) {
          this.prefetchPaused = true;
          this.message = this.needsOlder ? "数据源未返回更早的时间范围，可重试加载" : "";
          break;
        }
        const satisfiedDemand = startedForDemand || this.needsOlder;
        this.nextBefore = page.nextBefore;
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
        if (!this.canLoadOlder) this.desiredViewport = this.viewport;
        this.updateBoundaryMessage();
        this.options.onChange(prepended);
      }
      if (this.needsOlder && this.message === "正在加载更早 K 线…") {
        this.message = "仍有更早历史待查询，可继续加载";
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
        this.nextBefore = 0;
        this.desiredViewport = this.viewport;
        this.updateBoundaryMessage();
      } else {
        this.message = "更早 K 线加载失败，已保留当前图表；可重试";
      }
    } finally {
      if (!this.cancelled && revision === this.revision) {
        this.controller = null;
        this.olderLoading = false;
        this.options.onChange(0);
        this.schedulePrefetch();
      }
    }
  }
}
