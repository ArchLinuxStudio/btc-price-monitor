import {
  CANDLE_INTERVALS,
  CandleHistoryError,
  candleIntervalLabel,
  candleSourceLabel,
  createCandleHistoryLoader,
  fetchRecentCandleHistory,
} from "./candle-history.js";
import type { Candle, CandleInterval } from "./candle-history.js";
import { parseChartSelection, serializeChartSelection } from "./chart-selection.js";
import type { ChartSelection } from "./chart-selection.js";
import { ChartNavigation, MAX_HISTORY_CANDLES } from "./chart-navigation.js";
import { projectChartCrosshair } from "./chart-crosshair.js";
import type { ChartPlot } from "./chart-crosshair.js";
import { layoutChartTimeAxis } from "./chart-time-axis.js";
import { ChartCurrentPrice } from "./chart-current-price.js";
import type { ChartCurrentPriceState } from "./chart-current-price.js";
import { ChartLiveCandles } from "./chart-live-candles.js";
import { projectChartPriceLine } from "./chart-price-line.js";
import {
  MIN_VISIBLE_CANDLES,
  candleBarGeometry,
  candleViewportBounds,
  createCandleViewport,
  isCandleViewportReset,
  normalizeCandleViewport,
} from "./chart-viewport.js";
import type { CandleViewport } from "./chart-viewport.js";
import { formatUsdPrice } from "./price-format.js";
import type { MarketSource } from "./price-feed.js";

interface TauriEvent<T> {
  payload: T;
}

interface TauriApi {
  core?: {
    invoke?: <T>(command: string, args?: unknown) => Promise<T>;
  };
  event?: {
    listen?: <T>(event: string, handler: (event: TauriEvent<T>) => void) => Promise<() => void>;
  };
}

type TauriGlobal = typeof globalThis & {
  __TAURI__?: TauriApi;
};

type ChartStateKind = "loading" | "empty" | "error" | "ready";

interface PanState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startViewport: CandleViewport;
}

const elements = {
  stage: document.querySelector<HTMLElement>("#chart-stage")!,
  canvas: document.querySelector<HTMLCanvasElement>("#candle-canvas")!,
  historyStart: document.querySelector<HTMLElement>("#history-start-marker")!,
  historyStartLabel: document.querySelector<HTMLElement>("#history-start-label")!,
  priceLine: document.querySelector<HTMLCanvasElement>("#current-price-canvas")!,
  currentPrice: document.querySelector<HTMLElement>("#current-price-marker")!,
  currentPriceValue: document.querySelector<HTMLElement>("#current-price-value")!,
  currentPriceStatus: document.querySelector<HTMLElement>("#current-price-status")!,
  crosshair: document.querySelector<HTMLCanvasElement>("#crosshair-canvas")!,
  crosshairPrice: document.querySelector<HTMLSpanElement>("#crosshair-price")!,
  crosshairTime: document.querySelector<HTMLSpanElement>("#crosshair-time")!,
  state: document.querySelector<HTMLElement>("#chart-state")!,
  stateMessage: document.querySelector<HTMLParagraphElement>("#state-message")!,
  stateSpinner: document.querySelector<HTMLSpanElement>("#state-spinner")!,
  retry: document.querySelector<HTMLButtonElement>("#retry-button")!,
  close: document.querySelector<HTMLButtonElement>("#close-chart")!,
  intervalToolbar: document.querySelector<HTMLElement>("#interval-toolbar")!,
  intervalButtons: Array.from(
    document.querySelectorAll<HTMLButtonElement>("#interval-toolbar [data-interval]"),
  ),
  intervalCaption: document.querySelector<HTMLSpanElement>("#interval-caption")!,
  viewCaption: document.querySelector<HTMLSpanElement>("#view-caption")!,
  zoomOut: document.querySelector<HTMLButtonElement>("#zoom-out")!,
  zoomIn: document.querySelector<HTMLButtonElement>("#zoom-in")!,
  resetView: document.querySelector<HTMLButtonElement>("#reset-view")!,
  symbol: document.querySelector<HTMLHeadingElement>("#chart-symbol")!,
  productName: document.querySelector<HTMLParagraphElement>("#product-name")!,
  marketBadge: document.querySelector<HTMLSpanElement>("#market-badge")!,
  sourceName: document.querySelector<HTMLSpanElement>("#source-name")!,
  summary: document.querySelector<HTMLParagraphElement>("#chart-summary")!,
  historyMessage: document.querySelector<HTMLSpanElement>("#history-message")!,
  loadOlder: document.querySelector<HTMLButtonElement>("#load-older")!,
};

const intervalValues = new Set<CandleInterval>(CANDLE_INTERVALS.map(({ value }) => value));
const AXIS_FONT = '600 12px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const marketSourceNames: Readonly<Record<MarketSource, string>> = Object.freeze({
  coinbase: "Coinbase",
  kraken: "Kraken",
  bitstamp: "Bitstamp",
  bitfinex: "Bitfinex",
  bybit: "Bybit",
  gate: "Gate",
});
const utcIntradayFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const utcDailyFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC",
  year: "2-digit",
  month: "2-digit",
  day: "2-digit",
});
const utcSummaryFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

let selection: ChartSelection | null = null;
let selectionKey: string | null = null;
let selectedInterval: CandleInterval = "1h";
let candles: Candle[] = [];
let viewport = createCandleViewport(0);
let navigation: ChartNavigation | null = null;
let panState: PanState | null = null;
let requestController: AbortController | null = null;
let requestRevision = 0;
let drawFrame: number | null = null;
let crosshairFrame: number | null = null;
let priceLineFrame: number | null = null;
let currentPriceFeed: ChartCurrentPrice | null = null;
let currentPriceKey: string | null = null;
let currentPriceState: ChartCurrentPriceState = { quote: null, stale: true };
let liveCandles: ChartLiveCandles | null = null;
let crosshairPointer: { readonly clientX: number; readonly clientY: number } | null = null;
let crosshairScale: { readonly plot: ChartPlot; readonly low: number; readonly high: number } | null = null;
let removeSelectionListener: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;

function tauriApi(): TauriApi | null {
  const tauri = (globalThis as TauriGlobal).__TAURI__;
  return tauri && tauri.core && typeof tauri.core.invoke === "function" ? tauri : null;
}

function invokeTauri<T>(command: "get_chart_selection" | "close_chart_window"): Promise<T> {
  const invoke = tauriApi()?.core?.invoke;
  if (!invoke) return Promise.reject(new Error("Tauri API is unavailable"));
  return invoke<T>(command);
}

function isCandleInterval(value: unknown): value is CandleInterval {
  return typeof value === "string" && intervalValues.has(value as CandleInterval);
}

function intervalLabel(interval: CandleInterval): string {
  return candleIntervalLabel(interval).replace("分", " 分钟");
}

function updateIntervalUi(): void {
  const label = intervalLabel(selectedInterval);
  elements.intervalCaption.textContent = `每根 ${label}`;
  for (const button of elements.intervalButtons) {
    const interval = button.dataset.interval;
    const selected = interval === selectedInterval;
    button.setAttribute("aria-pressed", String(selected));
    if (isCandleInterval(interval)) {
      button.setAttribute("aria-label", `每根 K 线 ${intervalLabel(interval)}`);
    }
  }
}

function updateInstrumentUi(nextSelection: ChartSelection | null): void {
  if (!nextSelection) {
    elements.symbol.textContent = "K线图";
    elements.productName.textContent = "等待主界面选择标的";
    elements.marketBadge.textContent = "行情";
    elements.sourceName.textContent = "—";
    return;
  }

  const { product, marketSource } = nextSelection;
  const perpetual = product.marketType === "perpetual";
  elements.symbol.textContent = product.symbol;
  elements.productName.textContent = product.name;
  elements.marketBadge.textContent = perpetual ? "USDT永续" : "USD现货";
  const supportedSource = candleSourceLabel(marketSource);
  elements.sourceName.textContent = supportedSource
    ?? (marketSource ? `${marketSourceNames[marketSource]} · 暂无K线` : "等待行情源");
}

function setChartState(kind: ChartStateKind, message: string): void {
  const ready = kind === "ready";
  elements.stage.setAttribute("aria-busy", String(kind === "loading"));
  elements.state.hidden = ready;
  elements.stateMessage.textContent = message;
  elements.stateSpinner.hidden = kind !== "loading";
  elements.retry.hidden = kind !== "error" && kind !== "empty";
}

function abortHistoryRequest(): void {
  liveCandles?.stop();
  liveCandles = null;
  clearCrosshair();
  requestRevision += 1;
  requestController?.abort();
  requestController = null;
  navigation?.cancel();
}

function stopCurrentPrice(): void {
  liveCandles?.stop();
  liveCandles = null;
  const feed = currentPriceFeed;
  currentPriceFeed = null;
  currentPriceKey = null;
  feed?.stop();
  currentPriceState = { quote: null, stale: true };
  drawCurrentPrice();
}

function ensureCurrentPrice(): void {
  if (!selection || document.visibilityState === "hidden") return;
  if (currentPriceFeed && currentPriceKey === selectionKey) return;
  stopCurrentPrice();
  if (!candleSourceLabel(selection.marketSource)) return;
  try {
    const feed = new ChartCurrentPrice({
      product: selection.product,
      marketSource: selection.marketSource,
      onChange: (state) => {
        if (currentPriceFeed !== feed) return;
        currentPriceState = state;
        liveCandles?.setQuote(state);
        schedulePriceLine();
      },
    });
    currentPriceFeed = feed;
    currentPriceKey = selectionKey;
    feed.start();
  } catch {
    stopCurrentPrice();
  }
}

function chartPlot(width: number, height: number): ChartPlot {
  const left = 16;
  const top = 22;
  const right = width < 520 ? 96 : 104;
  const bottom = 40;
  return {
    left,
    top,
    width: Math.max(1, width - left - right),
    height: Math.max(1, height - top - bottom),
  };
}

function cancelPan(releaseCapture = true): void {
  const activePan = panState;
  panState = null;
  elements.canvas.classList.remove("is-panning");
  if (!activePan || !releaseCapture || !elements.canvas.hasPointerCapture(activePan.pointerId)) {
    return;
  }
  try {
    elements.canvas.releasePointerCapture(activePan.pointerId);
  } catch {
    // The WebView may already have released capture while hiding the window.
  }
}

function updateViewportControls(): void {
  const total = candles.length;
  viewport = normalizeCandleViewport(viewport, total);
  const minimum = Math.min(MIN_VISIBLE_CANDLES, total);
  const tolerance = Math.max(1, total) * Number.EPSILON * 32;
  const reset = isCandleViewportReset(viewport, total);
  const bounds = candleViewportBounds(viewport, total);

  elements.zoomIn.disabled = total === 0 || viewport.count <= minimum + tolerance;
  elements.zoomOut.disabled = total === 0
    || viewport.count >= MAX_HISTORY_CANDLES - tolerance
    || (viewport.count >= total - tolerance && !navigation?.canLoadOlder);
  elements.resetView.disabled = total === 0 || (reset && !navigation?.needsOlder);
  elements.canvas.classList.toggle("is-pannable", total > 0);
  elements.viewCaption.textContent = total === 0
    ? "显示 0 / 0 根 · UTC+0"
    : `显示 ${bounds.endIndex - bounds.startIndex} / ${total} 根 · UTC+0`;
  elements.historyMessage.textContent = navigation?.historyMessage ?? "";
  elements.loadOlder.hidden = !navigation?.canLoadOlder
    || (!navigation.needsOlder && total > 0);
  elements.loadOlder.disabled = navigation?.loadingOlder ?? false;
  elements.loadOlder.textContent = navigation?.loadingOlder ? "加载中…" : "继续加载";
}

function updateReadySummary(): void {
  if (!selection || candles.length === 0) return;
  const bounds = candleViewportBounds(viewport, candles.length);
  const first = candles[bounds.startIndex];
  const last = candles[bounds.endIndex - 1];
  const visibleCount = bounds.endIndex - bounds.startIndex;
  const summary = `${selection.product.symbol}，${currentSourceLabel()}，每根 ${intervalLabel(selectedInterval)}，`
    + `已加载 ${candles.length} 根；当前显示第 ${bounds.startIndex + 1} 至 ${bounds.endIndex} 根，`
    + `从 ${utcSummaryFormatter.format(first.openTime)} 到 ${utcSummaryFormatter.format(last.openTime)} UTC；`
    + `视图末根开盘 ${formatUsdPrice(last.open)}，最高 ${formatUsdPrice(last.high)}，`
    + `最低 ${formatUsdPrice(last.low)}，收盘 ${formatUsdPrice(last.close)}`;
  elements.summary.textContent = summary;
  elements.canvas.setAttribute(
    "aria-label",
    `${selection.product.symbol} 每根 ${intervalLabel(selectedInterval)} K 线图，`
      + `当前显示 ${visibleCount} / ${candles.length} 根，`
      + `${utcSummaryFormatter.format(first.openTime)} 至 ${utcSummaryFormatter.format(last.openTime)} UTC`,
  );
}

function updateViewportPresentation(updateAccessibility = true): void {
  updateViewportControls();
  if (updateAccessibility) updateReadySummary();
}

function syncNavigation(prepended: number): void {
  if (!navigation) return;
  candles = navigation.candles;
  viewport = navigation.viewport;
  if (panState && prepended !== 0) {
    panState = {
      ...panState,
      startViewport: {
        ...panState.startViewport,
        start: panState.startViewport.start + prepended,
      },
    };
  }
  updateViewportControls();
  if (candles.length > 0) setChartState("ready", "");
  else if (!navigation.canLoadOlder) {
    setChartState("empty", navigation.historyMessage || "该数据源暂无可查询的历史 K 线");
  }
  scheduleDraw();
}

function resetViewport(): void {
  cancelPan();
  navigation?.reset();
  viewport = createCandleViewport(candles.length);
  updateViewportControls();
  scheduleDraw();
}

function clearChart(summary: string): void {
  clearCrosshair();
  crosshairScale = null;
  drawCurrentPrice();
  elements.historyStart.hidden = true;
  cancelPan();
  navigation?.cancel();
  navigation = null;
  candles = [];
  viewport = createCandleViewport(0);
  updateViewportControls();
  elements.summary.textContent = summary;
  elements.canvas.setAttribute("aria-label", summary);
  scheduleDraw();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function historyErrorMessage(error: unknown): string {
  if (error instanceof CandleHistoryError) return error.message;
  return "K 线加载失败，请稍后重试";
}

function currentSourceLabel(): string {
  if (!selection) return "未知来源";
  return candleSourceLabel(selection.marketSource)
    ?? (selection.marketSource ? marketSourceNames[selection.marketSource] : "未知来源");
}

async function loadHistory(): Promise<void> {
  abortHistoryRequest();
  if (!selection) {
    stopCurrentPrice();
    clearChart("尚未选择 K 线标的");
    setChartState("empty", "请在主行情窗口点击一个标的查看 K 线");
    return;
  }
  if (document.visibilityState === "hidden") return;

  const revision = requestRevision;
  const controller = new AbortController();
  requestController = controller;
  clearChart(`${selection.product.symbol} K 线正在加载`);
  setChartState(
    "loading",
    `正在加载 ${selection.product.symbol} 的每根 ${intervalLabel(selectedInterval)} K 线…`,
  );

  try {
    const selectedProduct = selection.product;
    const selectedSource = selection.marketSource;
    const interval = selectedInterval;
    ensureCurrentPrice();
    const loadPage = createCandleHistoryLoader({
      product: selectedProduct,
      marketSource: selectedSource,
      interval,
    });
    const snapshotStartedAt = Date.now();
    const page = await loadPage(undefined, controller.signal);
    if (revision !== requestRevision || controller.signal.aborted) return;
    requestController = null;
    navigation = new ChartNavigation(page, {
      loadPage,
      onChange: syncNavigation,
    });
    candles = navigation.candles;
    viewport = navigation.viewport;
    const selectedNavigation = navigation;
    const live = new ChartLiveCandles({
      interval,
      productId: selectedProduct.id,
      marketSource: selectedSource!,
      snapshotStartedAt,
      getCandles: () => selectedNavigation.candles,
      mergeCandles: (recent) => selectedNavigation.mergeRecentCandles(recent, panState === null),
      loadRecent: (signal) => fetchRecentCandleHistory({
        product: selectedProduct, marketSource: selectedSource, interval, signal,
      }),
      onChange: () => { if (liveCandles === live) scheduleDraw(); },
    });
    liveCandles = live;
    live.start();
    live.setQuote(currentPriceState);
    navigation.startPrefetch();
    if (candles.length === 0) {
      updateViewportControls();
      elements.summary.textContent = `${selection.product.symbol} 当前范围暂无 K 线数据`;
      setChartState("empty", navigation.canLoadOlder
        ? "当前查询范围暂无 K 线，可继续查询更早历史"
        : "该数据源暂无可查询的历史 K 线");
      return;
    }

    viewport = createCandleViewport(candles.length);
    updateViewportPresentation();
    setChartState("ready", "");
    scheduleDraw();
  } catch (error) {
    if (revision !== requestRevision || isAbortError(error)) return;
    requestController = null;
    stopCurrentPrice();
    clearChart(`${selection.product.symbol} K 线加载失败`);
    setChartState("error", historyErrorMessage(error));
  }
}

function acceptSelection(value: unknown, reloadUnchanged: boolean): void {
  const parsed = parseChartSelection(value);
  if (!parsed) {
    stopCurrentPrice();
    selection = null;
    selectionKey = null;
    updateInstrumentUi(null);
    abortHistoryRequest();
    clearChart("K 线标的无效");
    setChartState("error", "无法读取主行情窗口选择的标的");
    return;
  }

  const nextKey = serializeChartSelection(parsed);
  const changed = nextKey !== selectionKey;
  if (changed) stopCurrentPrice();
  selection = parsed;
  selectionKey = nextKey;
  updateInstrumentUi(parsed);
  if (changed || reloadUnchanged) void loadHistory();
}

async function refreshSelectionFromNative(reloadUnchanged: boolean): Promise<void> {
  try {
    const value = await invokeTauri<unknown>("get_chart_selection");
    if (value === null || value === undefined) {
      stopCurrentPrice();
      selection = null;
      selectionKey = null;
      updateInstrumentUi(null);
      abortHistoryRequest();
      clearChart("尚未选择 K 线标的");
      setChartState("empty", "请在主行情窗口点击一个标的查看 K 线");
      return;
    }
    acceptSelection(value, reloadUnchanged);
  } catch {
    stopCurrentPrice();
    abortHistoryRequest();
    clearChart("无法连接图表窗口接口");
    setChartState("error", "无法读取主行情窗口选择的标的");
  }
}

async function closeChart(): Promise<void> {
  stopCurrentPrice();
  abortHistoryRequest();
  resetViewport();
  try {
    await invokeTauri<void>("close_chart_window");
  } catch {
    setChartState("error", "无法关闭 K 线窗口，请稍后重试");
  }
}

function drawTimeLabel(candle: Candle): string {
  return (selectedInterval === "1d" ? utcDailyFormatter : utcIntradayFormatter)
    .format(candle.openTime)
    .replace(/\//g, "-");
}

function drawCandles(): void {
  drawFrame = null;
  crosshairScale = null;
  elements.historyStart.hidden = true;
  const bounds = elements.canvas.getBoundingClientRect();
  const width = Math.floor(bounds.width);
  const height = Math.floor(bounds.height);
  const pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const backingWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
  const backingHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (elements.canvas.width !== backingWidth || elements.canvas.height !== backingHeight) {
    elements.canvas.width = backingWidth;
    elements.canvas.height = backingHeight;
  }

  const context = elements.canvas.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  drawCurrentPrice();
  drawCrosshair();
  if (candles.length === 0) {
    updateViewportControls();
    return;
  }
  updateViewportPresentation(panState === null);
  if (width < 160 || height < 120) return;

  viewport = normalizeCandleViewport(viewport, candles.length);
  const visibleBounds = candleViewportBounds(viewport, candles.length);
  const plot = chartPlot(bounds.width, bounds.height);
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (let index = visibleBounds.startIndex; index < visibleBounds.endIndex; index += 1) {
    const candle = candles[index];
    lowest = Math.min(lowest, candle.low);
    highest = Math.max(highest, candle.high);
  }
  const rawRange = highest - lowest;
  const padding = rawRange > 0 ? rawRange * 0.06 : Math.max(highest * 0.006, 0.00000001);
  const priceLow = Math.max(0, lowest - padding);
  const priceHigh = highest + padding;
  const priceRange = priceHigh - priceLow;
  crosshairScale = { plot, low: priceLow, high: priceHigh };
  const priceY = (price: number): number => (
    plot.top + ((priceHigh - price) / priceRange) * plot.height
  );

  context.font = AXIS_FONT;
  context.textBaseline = "middle";
  context.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = plot.top + plot.height * ratio;
    const price = priceHigh - priceRange * ratio;
    context.beginPath();
    context.strokeStyle = "#202733";
    context.moveTo(plot.left, Math.round(y) + 0.5);
    context.lineTo(plot.left + plot.width, Math.round(y) + 0.5);
    context.stroke();
    context.fillStyle = "#b9c5d7";
    context.textAlign = "left";
    context.fillText(formatUsdPrice(price), plot.left + plot.width + 9, y);
  }

  const { spacing: slotWidth, bodyWidth } = candleBarGeometry(plot.width, viewport.count);
  context.lineWidth = Math.min(1, bodyWidth);
  context.save();
  context.beginPath();
  context.rect(plot.left, plot.top, plot.width, plot.height);
  context.clip();
  for (let index = visibleBounds.startIndex; index < visibleBounds.endIndex; index += 1) {
    const candle = candles[index];
    const x = plot.left + (index + 0.5 - viewport.start) * slotWidth;
    const openY = priceY(candle.open);
    const closeY = priceY(candle.close);
    const highY = priceY(candle.high);
    const lowY = priceY(candle.low);
    const color = candle.close >= candle.open ? "#3dd49a" : "#f16b75";

    context.strokeStyle = color;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x, highY);
    context.lineTo(x, lowY);
    context.stroke();
    const bodyTop = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    context.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
  }
  context.restore();

  const startLabel = `历史起点 · ${drawTimeLabel(candles[0])}`;
  const axis = layoutChartTimeAxis(viewport, candles.length, plot,
    (index) => context.measureText(drawTimeLabel(candles[index])).width,
    navigation?.historyStartReached ? Math.ceil(context.measureText(startLabel).width) + 30 : null);
  if (axis.startMarker) {
    const marker = axis.startMarker;
    elements.historyStartLabel.textContent = startLabel;
    elements.historyStart.setAttribute("aria-label", `已确认到达该数据源的历史起点，${utcSummaryFormatter.format(candles[0].openTime)} UTC`);
    elements.historyStart.style.left = `${marker.left}px`;
    elements.historyStart.style.top = `${plot.top + plot.height + 7}px`;
    elements.historyStart.style.width = `${marker.width}px`;
    elements.historyStart.style.setProperty("--start-anchor", `${marker.x - marker.left}px`);
    elements.historyStart.hidden = false;
  }
  context.fillStyle = "#b9c5d7";
  context.textBaseline = "top";
  for (const tick of axis.ticks) {
    context.textAlign = "center";
    context.fillText(drawTimeLabel(candles[tick.index]), tick.x, plot.top + plot.height + 11);
  }
  drawCurrentPrice();
  drawCrosshair();
}

function drawCurrentPrice(): void {
  if (priceLineFrame !== null) cancelAnimationFrame(priceLineFrame);
  priceLineFrame = null;
  elements.currentPrice.hidden = true;
  const bounds = elements.canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const width = Math.max(1, Math.round(bounds.width * pixelRatio));
  const height = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (elements.priceLine.width !== width || elements.priceLine.height !== height) {
    elements.priceLine.width = width;
    elements.priceLine.height = height;
  }
  const context = elements.priceLine.getContext("2d");
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  const { price, stale, syncing } = liveCandles?.state ?? { price: null, stale: true, syncing: false };
  if (price === null || !crosshairScale || candles.length === 0) return;
  const { plot } = crosshairScale;
  const position = projectChartPriceLine(price, plot, crosshairScale);
  if (!position) return;
  const rising = price >= candles[candles.length - 1].open;
  const color = stale || syncing ? "#8793a5" : rising ? "#3dd49a" : "#f16b75";
  if (position.lineY !== null) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.moveTo(plot.left, position.lineY);
    context.lineTo(plot.left + plot.width, position.lineY);
    context.stroke();
  }
  const prefix = position.edge === "above" ? "↑ " : position.edge === "below" ? "↓ " : "";
  const priceLabel = `${prefix}${formatUsdPrice(price)}`;
  const statusText = stale ? "报价滞后" : syncing ? "同步 K 线…" : "";
  context.font = AXIS_FONT;
  const markerWidth = Math.min(bounds.width - plot.left - plot.width,
    Math.max(Math.ceil(context.measureText(priceLabel).width) + 16, statusText ? 84 : 0));
  elements.currentPriceValue.textContent = priceLabel;
  elements.currentPriceStatus.textContent = statusText;
  elements.currentPriceStatus.hidden = !statusText;
  elements.currentPrice.dataset.direction = stale || syncing ? "stale" : rising ? "up" : "down";
  elements.currentPrice.dataset.syncing = String(syncing);
  elements.currentPrice.dataset.edge = position.edge ?? "none";
  elements.currentPrice.style.left = `${plot.left + plot.width}px`;
  elements.currentPrice.style.top = `${Math.max(0, Math.min(bounds.height - (statusText ? 40 : 24), position.labelY - 12))}px`;
  elements.currentPrice.style.width = `${markerWidth}px`;
  const outside = position.edge === "above" ? "，高于当前可视价格范围"
    : position.edge === "below" ? "，低于当前可视价格范围" : "";
  elements.currentPrice.setAttribute("aria-label",
    `${stale ? "最新 K 线价格，报价滞后" : syncing ? "最新 K 线价格，同步中" : "当前价格"} ${formatUsdPrice(price)} ${selection?.product.quoteCurrency ?? "USD"}，${currentSourceLabel()}${outside}`);
  elements.currentPrice.hidden = false;
}

function schedulePriceLine(): void {
  if (priceLineFrame !== null || drawFrame !== null) return;
  priceLineFrame = requestAnimationFrame(drawCurrentPrice);
}

// Pointer motion redraws only this transparent layer, leaving the candle canvas intact.
function drawCrosshair(): void {
  if (crosshairFrame !== null) cancelAnimationFrame(crosshairFrame);
  crosshairFrame = null;
  const bounds = elements.canvas.getBoundingClientRect();
  const pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  const backingWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
  const backingHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
  if (elements.crosshair.width !== backingWidth || elements.crosshair.height !== backingHeight) {
    elements.crosshair.width = backingWidth;
    elements.crosshair.height = backingHeight;
  }
  const context = elements.crosshair.getContext("2d");
  elements.crosshairPrice.hidden = true;
  elements.crosshairTime.hidden = true;
  if (!context) return;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, bounds.width, bounds.height);
  if (!crosshairPointer || !crosshairScale || document.visibilityState === "hidden") return;
  const { plot } = crosshairScale;
  const position = projectChartCrosshair({
    x: crosshairPointer.clientX - bounds.left,
    y: crosshairPointer.clientY - bounds.top,
  }, plot, viewport, candles.length, crosshairScale);
  if (!position) return;

  context.strokeStyle = "#8994a5";
  context.lineWidth = 1;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(position.x, plot.top);
  context.lineTo(position.x, plot.top + plot.height);
  context.moveTo(plot.left, position.y);
  context.lineTo(plot.left + plot.width, position.y);
  context.stroke();

  const priceLabel = position.price === 0 ? "0.00" : formatUsdPrice(position.price);
  context.font = AXIS_FONT;
  const priceWidth = Math.min(bounds.width - plot.left - plot.width, Math.ceil(context.measureText(priceLabel).width) + 16);
  elements.crosshairPrice.textContent = priceLabel;
  elements.crosshairPrice.style.left = `${plot.left + plot.width}px`;
  elements.crosshairPrice.style.top = `${Math.max(0, Math.min(bounds.height - 24, position.y - 12))}px`;
  elements.crosshairPrice.style.width = `${priceWidth}px`;
  elements.crosshairPrice.hidden = false;
  if (position.index !== null) {
    const timeLabel = utcSummaryFormatter.format(candles[position.index].openTime).replace(/\//g, "-");
    const timeWidth = Math.min(bounds.width, Math.ceil(context.measureText(timeLabel).width) + 16);
    elements.crosshairTime.textContent = timeLabel;
    elements.crosshairTime.style.left = `${Math.max(0, Math.min(bounds.width - timeWidth, position.x - timeWidth / 2))}px`;
    elements.crosshairTime.style.top = `${plot.top + plot.height + 7}px`;
    elements.crosshairTime.style.width = `${timeWidth}px`;
    elements.crosshairTime.hidden = false;
  }
}

function scheduleCrosshair(): void {
  if (crosshairFrame !== null || drawFrame !== null) return;
  crosshairFrame = requestAnimationFrame(drawCrosshair);
}

function clearCrosshair(): void {
  crosshairPointer = null;
  drawCrosshair();
}

function trackCrosshair(event: PointerEvent): void {
  if (!event.isPrimary || event.pointerType === "touch") return;
  crosshairPointer = { clientX: event.clientX, clientY: event.clientY };
  scheduleCrosshair();
}

function scheduleDraw(): void {
  if (drawFrame !== null) return;
  drawFrame = requestAnimationFrame(drawCandles);
}

function zoomViewport(scale: number, anchor?: number): void {
  if (candles.length === 0) return;
  cancelPan();
  navigation?.zoom(scale, anchor);
}

function panViewport(delta: number): void {
  if (candles.length === 0) return;
  cancelPan();
  navigation?.pan(delta);
}

function wheelDeltaPixels(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16;
  if (event.deltaMode === 2) return event.deltaY * Math.max(1, pageHeight);
  return event.deltaY;
}

function handleCanvasWheel(event: WheelEvent): void {
  if (candles.length === 0 || event.deltaY === 0) return;
  const canvasBounds = elements.canvas.getBoundingClientRect();
  const plot = chartPlot(canvasBounds.width, canvasBounds.height);
  const anchor = Math.min(
    1,
    Math.max(0, (event.clientX - canvasBounds.left - plot.left) / plot.width),
  );
  const deltaPixels = Math.min(
    240,
    Math.max(-240, wheelDeltaPixels(event, canvasBounds.height)),
  );
  event.preventDefault();
  zoomViewport(Math.exp(-deltaPixels * 0.002), anchor);
}

function handlePointerDown(event: PointerEvent): void {
  trackCrosshair(event);
  if (
    candles.length === 0
    || !event.isPrimary
    || event.button !== 0
  ) {
    return;
  }
  const canvasBounds = elements.canvas.getBoundingClientRect();
  const plot = chartPlot(canvasBounds.width, canvasBounds.height);
  const localX = event.clientX - canvasBounds.left;
  const localY = event.clientY - canvasBounds.top;
  if (
    localX < plot.left
    || localX > plot.left + plot.width
    || localY < plot.top
    || localY > plot.top + plot.height
  ) {
    return;
  }

  cancelPan();
  try {
    elements.canvas.setPointerCapture(event.pointerId);
  } catch {
    return;
  }
  navigation?.setViewport(viewport);
  panState = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startViewport: viewport,
  };
  elements.canvas.classList.add("is-panning");
  elements.canvas.focus({ preventScroll: true });
  event.preventDefault();
}

function handlePointerMove(event: PointerEvent): void {
  trackCrosshair(event);
  if (!panState || event.pointerId !== panState.pointerId) return;
  const canvasBounds = elements.canvas.getBoundingClientRect();
  const plot = chartPlot(canvasBounds.width, canvasBounds.height);
  const delta = (
    (panState.startClientX - event.clientX) * panState.startViewport.count / plot.width
  );
  const requestedStart = panState.startViewport.start + delta;
  navigation?.setViewport({
    start: requestedStart,
    count: panState.startViewport.count,
  });
  if (Math.abs(viewport.start - requestedStart) > 1e-8) {
    // Discard movement beyond the edge so reversing a held drag responds at once.
    panState = { pointerId: event.pointerId, startClientX: event.clientX, startViewport: viewport };
  }
  event.preventDefault();
}

function finishPointerPan(event: PointerEvent): void {
  if (!panState || event.pointerId !== panState.pointerId) return;
  event.preventDefault();
  cancelPan();
  scheduleDraw();
}

function handleCanvasKeydown(event: KeyboardEvent): void {
  if (candles.length === 0 || event.ctrlKey || event.metaKey || event.altKey) return;
  const panStep = Math.max(1, viewport.count * 0.1);
  let handled = true;
  switch (event.key) {
    case "+":
    case "=":
      zoomViewport(1.4);
      break;
    case "-":
    case "_":
      zoomViewport(1 / 1.4);
      break;
    case "ArrowLeft":
      panViewport(-panStep);
      break;
    case "ArrowRight":
      panViewport(panStep);
      break;
    case "Home":
      cancelPan();
      navigation?.setViewport({ start: 0, count: viewport.count });
      break;
    case "End":
      panViewport(Number.POSITIVE_INFINITY);
      break;
    case "0":
      resetViewport();
      break;
    default:
      handled = false;
  }
  if (handled) event.preventDefault();
}

function selectInterval(interval: CandleInterval): void {
  if (interval === selectedInterval) return;
  abortHistoryRequest();
  selectedInterval = interval;
  updateIntervalUi();
  void loadHistory();
}

elements.intervalToolbar.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest<HTMLButtonElement>("button[data-interval]");
  const interval = button?.dataset.interval;
  if (button && elements.intervalToolbar.contains(button) && isCandleInterval(interval)) {
    selectInterval(interval);
  }
});

elements.intervalToolbar.addEventListener("keydown", (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  const index = elements.intervalButtons.indexOf(event.target);
  if (index < 0) return;
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    nextIndex = (index + 1) % elements.intervalButtons.length;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    nextIndex = (index - 1 + elements.intervalButtons.length) % elements.intervalButtons.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = elements.intervalButtons.length - 1;
  }
  if (nextIndex === null) return;
  event.preventDefault();
  elements.intervalButtons[nextIndex].focus();
});

elements.zoomOut.addEventListener("click", () => zoomViewport(1 / 1.4));
elements.zoomIn.addEventListener("click", () => zoomViewport(1.4));
elements.resetView.addEventListener("click", resetViewport);
elements.canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
elements.canvas.addEventListener("pointerdown", handlePointerDown);
elements.canvas.addEventListener("pointermove", handlePointerMove);
elements.canvas.addEventListener("pointerup", finishPointerPan);
elements.canvas.addEventListener("pointerleave", clearCrosshair);
elements.canvas.addEventListener("pointercancel", (event) => {
  finishPointerPan(event);
  clearCrosshair();
});
elements.canvas.addEventListener("lostpointercapture", (event) => {
  if (panState?.pointerId === event.pointerId) cancelPan(false);
});
elements.canvas.addEventListener("dblclick", (event) => {
  if (candles.length === 0
    || (isCandleViewportReset(viewport, candles.length) && !navigation?.needsOlder)) return;
  event.preventDefault();
  resetViewport();
});
elements.canvas.addEventListener("keydown", handleCanvasKeydown);
elements.retry.addEventListener("click", () => void refreshSelectionFromNative(true));
elements.loadOlder.addEventListener("click", () => navigation?.continueLoading());
elements.close.addEventListener("click", () => void closeChart());

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  void closeChart();
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    stopCurrentPrice();
    abortHistoryRequest();
    resetViewport();
  } else {
    void refreshSelectionFromNative(true);
    scheduleDraw();
  }
});

globalThis.addEventListener("focus", () => void refreshSelectionFromNative(false));
globalThis.addEventListener("blur", clearCrosshair);
globalThis.addEventListener("resize", scheduleDraw);
globalThis.addEventListener("online", () => void refreshSelectionFromNative(true));
globalThis.addEventListener("pagehide", () => {
  stopCurrentPrice();
  abortHistoryRequest();
  resetViewport();
});
globalThis.addEventListener("beforeunload", () => {
  stopCurrentPrice();
  abortHistoryRequest();
  cancelPan();
  removeSelectionListener?.();
  resizeObserver?.disconnect();
}, { once: true });

async function initialize(): Promise<void> {
  updateIntervalUi();
  updateViewportControls();
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(scheduleDraw);
    resizeObserver.observe(elements.stage);
  }

  const listen = tauriApi()?.event?.listen;
  if (listen) {
    try {
      removeSelectionListener = await listen<string>("chart-selection-changed", (event) => {
        acceptSelection(event.payload, true);
      });
    } catch {
      removeSelectionListener = null;
    }
  }
  await refreshSelectionFromNative(false);
}

void initialize();
