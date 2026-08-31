import { PriceFeed } from "./price-feed.js";
import type { DisplayQuote, FeedStatus, PriceFeedState } from "./price-feed.js";
import { formatUsdPrice } from "./price-format.js";
import {
  applyBackupSourceMappings,
  fetchBackupSourceMappings,
  fetchProductCatalogSnapshot,
  loadWatchlist,
  refreshProductsFromCatalog,
  reorderWatchlist,
  saveWatchlist,
  searchProducts,
} from "./watchlist.js";
import type { BackupSourceMappings, Product } from "./watchlist.js";

interface QuoteView {
  row: HTMLElement;
  price: HTMLSpanElement;
  change: HTMLSpanElement;
}

interface MonitorLayout {
  rowCount: number;
  managementOpen: boolean;
  itemCount: number;
}

interface MonitorHeightRequest {
  rowCount: number;
  requestedHeight: number;
}

interface ResizeDragState {
  startHeight: number;
  startClientY: number;
  pointerId: number | null;
}

interface QuoteDragState {
  productId: string;
  row: HTMLElement;
}

interface QuoteDropState {
  row: HTMLElement;
  placeAfter: boolean;
}

interface TauriApi {
  core?: {
    invoke?: (command: string, args?: unknown) => Promise<unknown>;
  };
}

type TauriGlobal = typeof globalThis & {
  __TAURI__?: TauriApi;
};

type TauriCommand =
  | "close_window"
  | "ensure_always_on_top"
  | "set_monitor_layout"
  | "resize_monitor_height";
type CatalogState = "idle" | "loading" | "ready" | "error";

const elements = {
  monitor: document.querySelector<HTMLElement>(".monitor")!,
  liveDot: document.querySelector<HTMLSpanElement>("#live-dot")!,
  statusText: document.querySelector<HTMLSpanElement>("#status-text")!,
  marketLabel: document.querySelector<HTMLSpanElement>("#market-label")!,
  sourceLabel: document.querySelector<HTMLSpanElement>("#source-label")!,
  updateTime: document.querySelector<HTMLSpanElement>("#update-time")!,
  watchlistButton: document.querySelector<HTMLButtonElement>("#watchlist-button")!,
  close: document.querySelector<HTMLButtonElement>("#close-button")!,
  quotes: document.querySelector<HTMLElement>("#quotes")!,
  quoteTemplate: document.querySelector<HTMLTemplateElement>("#quote-row-template")!,
  manager: document.querySelector<HTMLElement>("#watchlist-manager")!,
  search: document.querySelector<HTMLInputElement>("#coin-search")!,
  managerList: document.querySelector<HTMLDivElement>("#manager-list")!,
  managerStatus: document.querySelector<HTMLSpanElement>("#manager-status")!,
  reorderStatus: document.querySelector<HTMLSpanElement>("#reorder-status")!,
  resizeHandle: document.querySelector<HTMLButtonElement>("#resize-handle")!,
};

const statusLabels: Record<FeedStatus, { compact: string; full: string }> = {
  live: { compact: "LIVE", full: "实时行情" },
  partial: { compact: "PART", full: "部分行情可用" },
  connecting: { compact: "LINK", full: "正在连接行情" },
  reconnecting: { compact: "RETRY", full: "正在重新连接" },
  offline: { compact: "OFF", full: "行情离线" },
};

const sourceLabels: Record<string, string> = {
  Coinbase: "Coinbase",
  Kraken: "Kraken",
  Bitstamp: "Bitstamp",
  Bitfinex: "Bitfinex",
  "Bybit Perp": "Bybit-P",
  "Gate Perp": "Gate-P",
  "Coinbase REST": "REST",
  "Bybit REST": "BY-REST",
  "Gate REST": "GT-REST",
};

const sourceAbbreviations: Record<string, string> = {
  Coinbase: "CB",
  Kraken: "KR",
  Bitstamp: "BS",
  Bitfinex: "BFX",
  "Bybit Perp": "BY",
  "Gate Perp": "GT",
  "Coinbase REST": "REST",
  "Bybit REST": "BY-R",
  "Gate REST": "GT-R",
};

const markerColorCount = 8;
const nativeManagementItemLimit = 4;

let selectedProducts: Product[] = loadWatchlist();
let quoteViews = new Map<string, QuoteView>();
const previousPrices = new Map<string, number>();
const priceAnimations = new Map<string, Animation>();
let latestState: PriceFeedState | null = null;
let pendingState: PriceFeedState | null = null;
let renderScheduled = false;
let lastRenderAt = 0;
let lastDataSecond: number | null = null;
let managementOpen = false;
let catalogState: CatalogState = "idle";
let catalog: Product[] = [];
let catalogRequest: Promise<Product[]> | null = null;
let backupSourceMappings: BackupSourceMappings = { bitstamp: null, bitfinex: null };
let backupSourceMappingState: CatalogState = "idle";
let backupSourceMappingRequest: Promise<BackupSourceMappings> | null = null;
let visibleSearchResults: Product[] = [];
let pendingLayout: MonitorLayout | null = null;
let layoutFrame: number | null = null;
let layoutQueue: Promise<unknown> = Promise.resolve();
let pendingResizeHeight: number | null = null;
let resizeFrame: number | null = null;
let resizeInFlight = false;
let resizeDrag: ResizeDragState | null = null;
let quoteDrag: QuoteDragState | null = null;
let quoteDrop: QuoteDropState | null = null;

function prefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function"
    && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function tauriInvoke(command: "set_monitor_layout", args: MonitorLayout): Promise<unknown>;
function tauriInvoke(command: "resize_monitor_height", args: MonitorHeightRequest): Promise<unknown>;
function tauriInvoke(command: "close_window" | "ensure_always_on_top"): Promise<unknown>;
function tauriInvoke(
  command: TauriCommand,
  args?: MonitorLayout | MonitorHeightRequest,
): Promise<unknown> {
  const tauri = (globalThis as TauriGlobal).__TAURI__;
  const invoke = tauri && tauri.core && tauri.core.invoke;
  if (!invoke) return Promise.resolve();
  return invoke(command, args).catch(() => undefined);
}

function updateQuoteOverflow(): void {
  const scrollable = !managementOpen
    && elements.quotes.scrollHeight > elements.quotes.clientHeight + 1;
  elements.quotes.classList.toggle("is-scrollable", scrollable);
  if (scrollable) {
    elements.quotes.tabIndex = 0;
    elements.quotes.setAttribute("aria-label", "自选品种实时价格，可用方向键滚动");
  } else {
    elements.quotes.removeAttribute("tabindex");
    elements.quotes.setAttribute("aria-label", "自选品种实时价格");
  }
}

function updateResizeHandleVisibility(): void {
  elements.resizeHandle.hidden = managementOpen || selectedProducts.length <= 4;
}

function scheduleMonitorHeight(): void {
  if (resizeFrame !== null || resizeInFlight || pendingResizeHeight === null) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    if (pendingResizeHeight === null) return;
    const height = pendingResizeHeight!;
    pendingResizeHeight = null;
    resizeInFlight = true;
    layoutQueue = layoutQueue
      .then(() => tauriInvoke("resize_monitor_height", {
        rowCount: selectedProducts.length,
        requestedHeight: height,
      }))
      .catch(() => undefined)
      .finally(() => {
        resizeInFlight = false;
        scheduleMonitorHeight();
      });
  });
}

function queueMonitorHeight(requestedHeight: number): void {
  pendingResizeHeight = Math.max(0, Math.round(requestedHeight));
  scheduleMonitorHeight();
}

function resizeHeightAt(clientY: number): number | null {
  if (!resizeDrag) return null;
  return resizeDrag.startHeight + clientY - resizeDrag.startClientY;
}

function clearResizeDrag(clearPending: boolean): void {
  resizeDrag = null;
  if (clearPending) pendingResizeHeight = null;
  elements.monitor.classList.remove("is-resizing");
}

function setMonitorLayout(itemCount: number): void {
  const requestedItemCount = Number.isFinite(itemCount) ? itemCount : selectedProducts.length;
  pendingLayout = {
    rowCount: selectedProducts.length,
    managementOpen,
    itemCount: Math.min(Math.max(0, Math.trunc(requestedItemCount)), nativeManagementItemLimit),
  };
  if (layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    const requestedLayout = pendingLayout!;
    pendingLayout = null;
    layoutQueue = layoutQueue
      .then(() => tauriInvoke("set_monitor_layout", requestedLayout))
      .catch(() => undefined);
  });
}

function clearElement(element: Element): void {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function clearQuoteDropIndicator(): void {
  if (!quoteDrop) return;
  quoteDrop.row.classList.remove("is-drop-before", "is-drop-after");
  quoteDrop = null;
}

function clearQuoteDrag(): void {
  clearQuoteDropIndicator();
  if (quoteDrag) quoteDrag.row.classList.remove("is-dragging");
  quoteDrag = null;
  elements.quotes.classList.remove("is-reordering");
}

function setQuoteDropIndicator(row: HTMLElement, placeAfter: boolean): void {
  if (quoteDrop?.row === row && quoteDrop.placeAfter === placeAfter) return;
  clearQuoteDropIndicator();
  row.classList.add(placeAfter ? "is-drop-after" : "is-drop-before");
  quoteDrop = { row, placeAfter };
}

function quoteRowFromEvent(event: Event): HTMLElement | null {
  if (!(event.target instanceof Element)) return null;
  const row = event.target.closest<HTMLElement>(".quote-row[data-product-id]");
  return row && elements.quotes.contains(row) ? row : null;
}

function reorderSelectedProduct(
  movingProductId: string,
  targetProductId: string,
  placeAfter: boolean,
): boolean {
  const previousOrder = selectedProducts.map((product) => product.id).join("\u0000");
  const reordered = reorderWatchlist(
    selectedProducts,
    movingProductId,
    targetProductId,
    placeAfter,
  );
  if (reordered.map((product) => product.id).join("\u0000") === previousOrder) return false;

  selectedProducts = saveWatchlist(reordered);
  rebuildQuoteRows();
  const product = selectedProducts.find((entry) => entry.id === movingProductId);
  const position = selectedProducts.findIndex((entry) => entry.id === movingProductId) + 1;
  if (product && position > 0) {
    elements.reorderStatus.textContent = `已将 ${product.symbol} 移至第 ${position} 项，共 ${selectedProducts.length} 项`;
  }
  return true;
}

function moveSelectedProductBy(movingProductId: string, offset: -1 | 1): void {
  const movingIndex = selectedProducts.findIndex((product) => product.id === movingProductId);
  const targetIndex = movingIndex + offset;
  if (movingIndex < 0 || targetIndex < 0 || targetIndex >= selectedProducts.length) return;
  const targetProduct = selectedProducts[targetIndex];
  if (!reorderSelectedProduct(movingProductId, targetProduct.id, offset > 0)) return;
  requestAnimationFrame(() => quoteViews.get(movingProductId)?.row.focus());
}

function productColorIndex(product: Product): number {
  if (product.id === "BTC-USD") return 0;
  if (product.id === "ETH-USD") return 1;
  let hash = 0;
  for (let offset = 0; offset < product.id.length; offset += 1) {
    hash = ((hash * 31) + product.id.charCodeAt(offset)) >>> 0;
  }
  return 2 + (hash % (markerColorCount - 2));
}

function productQuoteCurrency(product: Product): "USD" | "USDT" {
  return product.quoteCurrency === "USDT" ? "USDT" : "USD";
}

function productMarketDescription(product: Product): string {
  return product.marketType === "perpetual" ? "股票类永续合约" : "现货";
}

function updateMarketLabel(): void {
  const currencies = new Set(selectedProducts.map(productQuoteCurrency));
  const mixed = currencies.size > 1;
  elements.marketLabel.textContent = mixed ? "USD/USDT" : currencies.has("USDT") ? "USDT" : "USD";
  elements.marketLabel.setAttribute(
    "aria-label",
    mixed ? "包含 USD 现货与 USDT 永续合约" : currencies.has("USDT") ? "USDT 计价" : "美元计价",
  );
}

function rebuildQuoteRows(): void {
  const previousScrollTop = elements.quotes.scrollTop;
  clearQuoteDrag();
  updateMarketLabel();
  const activeIds = new Set<string>(selectedProducts.map((product) => product.id));
  for (const animation of priceAnimations.values()) {
    if (animation) animation.cancel();
  }
  priceAnimations.clear();
  for (const productId of previousPrices.keys()) {
    if (!activeIds.has(productId)) previousPrices.delete(productId);
  }

  clearElement(elements.quotes);
  quoteViews = new Map<string, QuoteView>();
  const fragment = document.createDocumentFragment();

  selectedProducts.forEach((product, index) => {
    const row = elements.quoteTemplate.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const marker = row.querySelector<HTMLSpanElement>(".asset-marker")!;
    const symbol = row.querySelector<HTMLElement>(".asset strong")!;
    const price = row.querySelector<HTMLSpanElement>(".price")!;
    const change = row.querySelector<HTMLSpanElement>(".change")!;
    row.dataset.productId = product.id;
    row.draggable = true;
    row.tabIndex = 0;
    row.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
    row.setAttribute("aria-describedby", "reorder-instructions");
    row.setAttribute(
      "aria-label",
      `${product.name}，${product.symbol}，${productQuoteCurrency(product)} 计价`
        + `${productMarketDescription(product)}行情，第 ${index + 1} 项，共 ${selectedProducts.length} 项`,
    );
    marker.classList.add(`marker-${productColorIndex(product)}`);
    symbol.textContent = product.symbol;
    if (product.symbol.length > 6) symbol.classList.add("is-long-symbol");
    if (product.symbol.length > 8) symbol.classList.add("is-very-long-symbol");
    quoteViews.set(product.id, { row, price, change });
    fragment.appendChild(row);
  });

  elements.quotes.appendChild(fragment);
  elements.quotes.scrollTop = previousScrollTop;
  updateResizeHandleVisibility();
  requestAnimationFrame(updateQuoteOverflow);
  if (latestState) render(latestState);
  if (!managementOpen) void setMonitorLayout(selectedProducts.length);
}

function queueRender(state: PriceFeedState): void {
  pendingState = state;
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(function drainFrame(frameTime: number) {
    if (frameTime - lastRenderAt < 33) {
      requestAnimationFrame(drainFrame);
      return;
    }
    renderScheduled = false;
    lastRenderAt = frameTime;
    latestState = pendingState!;
    pendingState = null;
    render(latestState);
  });
}

function compactSourceLabel(sources: string[]): string {
  if (sources.length === 0) return "Coinbase";
  if (sources.length === 1) return sourceLabels[sources[0]] || sources[0];
  const compact = sources.map((source) => sourceAbbreviations[source] || source);
  return compact.length === 2 ? compact.join("/") : `${compact[0]}+${compact.length - 1}`;
}

function render(state: PriceFeedState): void {
  const status = statusLabels[state.status] ? state.status : "offline";
  const statusLabel = statusLabels[status];
  elements.liveDot.className = `live-dot is-${status}`;
  elements.statusText.textContent = statusLabel.compact;
  elements.statusText.setAttribute("aria-label", statusLabel.full);

  const sources = new Set<string>();
  for (const product of selectedProducts) {
    const quote = state.prices[product.id] || state.prices[product.symbol];
    renderQuote(product, quote);
    if (quote && quote.sourceLabel) sources.add(quote.sourceLabel);
  }

  const sourceList = Array.from(sources);
  elements.sourceLabel.textContent = compactSourceLabel(sourceList);
  elements.sourceLabel.setAttribute("aria-label", sourceList.length > 0
    ? sourceList.join(" / ")
    : "等待 Coinbase、Kraken、Bitstamp、Bitfinex、Bybit 或 Gate 行情");

  const dataSecond = state.lastUpdateAt ? Math.floor(state.lastUpdateAt / 1_000) : null;
  if (dataSecond !== lastDataSecond) {
    lastDataSecond = dataSecond;
    renderUpdateTime(state.lastUpdateAt);
  }
}

function renderQuote(product: Product, quote: DisplayQuote | null | undefined): void {
  const view = quoteViews.get(product.id);
  if (!view) return;

  if (!quote) {
    view.price.textContent = "—";
    view.price.setAttribute("aria-label", `${product.symbol} 价格尚不可用`);
    view.change.textContent = "—";
    view.change.className = "change neutral";
    view.change.setAttribute("aria-label", `${product.symbol} 当日涨跌尚不可用`);
    view.row.classList.add("is-stale");
    previousPrices.delete(product.id);
    return;
  }

  const previous = previousPrices.has(product.id) ? previousPrices.get(product.id)! : null;
  const formattedPrice = formatUsdPrice(quote.price);
  view.price.textContent = formattedPrice;
  view.price.setAttribute(
    "aria-label",
    `${product.symbol} ${formattedPrice} ${productQuoteCurrency(product)}`,
  );
  view.row.classList.toggle("is-stale", quote.stale);

  if (quote.changeUtc === null) {
    view.change.textContent = "—";
    view.change.className = "change neutral";
    view.change.setAttribute("aria-label", `${product.symbol} 相对当天 00:00 UTC 的涨跌尚不可用`);
  } else {
    const direction = quote.changeUtc > 0 ? "up" : quote.changeUtc < 0 ? "down" : "neutral";
    const sign = quote.changeUtc > 0 ? "+" : quote.changeUtc < 0 ? "−" : "";
    const changeText = `${sign}${Math.abs(quote.changeUtc).toFixed(2)}%`;
    view.change.textContent = changeText;
    view.change.className = `change ${direction}`;
    view.change.setAttribute(
      "aria-label",
      `${product.symbol} 相对当天 00:00 UTC ${quote.changeUtc >= 0 ? "上涨" : "下跌"} ${Math.abs(quote.changeUtc).toFixed(2)}%`,
    );
  }

  if (previous !== null && quote.price !== previous && !prefersReducedMotion()) {
    const tickColor = quote.price > previous ? "#3dd49a" : "#f16b75";
    const previousAnimation = priceAnimations.get(product.id);
    if (previousAnimation) previousAnimation.cancel();
    if (typeof view.price.animate === "function") {
      priceAnimations.set(product.id, view.price.animate(
        [{ color: tickColor }, { color: "#f3f5f8" }],
        { duration: 200, easing: "ease-out" },
      ));
    }
  }
  previousPrices.set(product.id, quote.price);
}

function renderUpdateTime(lastUpdateAt: number | null): void {
  if (!lastUpdateAt) {
    elements.updateTime.textContent = "等待首笔行情";
    return;
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastUpdateAt) / 1_000));
  const age = ageSeconds < 2 ? "刚刚" : `${ageSeconds} 秒前`;
  elements.updateTime.textContent = `行情最后更新于${age}`;
}

function announceManager(message: string): void {
  elements.managerStatus.textContent = message;
}

function managerCell(className: string, text: string): HTMLSpanElement {
  const cell = document.createElement("span");
  cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderSelectedProduct(product: Product, index: number): void {
  const row = document.createElement("div");
  row.className = "manager-row";
  row.appendChild(managerCell("manager-symbol", product.symbol));
  row.appendChild(managerCell("manager-name", product.name));

  if (product.fixed) {
    const fixed = managerCell("manager-action is-fixed", "•");
    fixed.setAttribute("aria-hidden", "true");
    row.setAttribute("aria-label", `${product.name}，固定币种`);
    row.appendChild(fixed);
  } else {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "manager-remove";
    remove.setAttribute("aria-label", `删除 ${product.symbol}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeProduct(product.id, index));
    row.appendChild(remove);
  }
  elements.managerList.appendChild(row);
}

function renderSearchProduct(product: Product): void {
  const selectedIndex = selectedProducts.findIndex((entry) => entry.id === product.id);
  if (selectedIndex >= 0) {
    renderSelectedProduct(selectedProducts[selectedIndex], selectedIndex);
    return;
  }

  const row = document.createElement("button");
  row.type = "button";
  row.className = "manager-row";
  row.setAttribute("aria-label", `添加 ${product.name} ${product.symbol}`);
  row.appendChild(managerCell("manager-symbol", product.symbol));
  row.appendChild(managerCell("manager-name", product.name));

  const action = managerCell("manager-action", "+");
  action.setAttribute("aria-hidden", "true");
  row.appendChild(action);
  row.addEventListener("click", () => addProduct(product));
  elements.managerList.appendChild(row);
}

function renderManagerMessage(message: string, retry: boolean): void {
  const row = document.createElement("p");
  row.className = "manager-message";
  row.appendChild(document.createTextNode(message));
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "manager-retry";
    button.setAttribute("aria-label", "重新加载币种列表");
    button.textContent = "↻";
    button.addEventListener("click", () => void ensureCatalog(true));
    row.appendChild(button);
  }
  elements.managerList.appendChild(row);
  void setMonitorLayout(1);
}

function renderManager(): void {
  if (!managementOpen) return;
  clearElement(elements.managerList);
  visibleSearchResults = [];
  const query = elements.search.value.trim();

  if (!query) {
    selectedProducts.forEach(renderSelectedProduct);
    void setMonitorLayout(selectedProducts.length);
    return;
  }

  if (catalogState === "idle" || catalogState === "loading") {
    renderManagerMessage("正在加载免费行情品种…", false);
    return;
  }
  if (catalogState === "error") {
    renderManagerMessage("币种列表加载失败", true);
    return;
  }

  visibleSearchResults = searchProducts(catalog, query, 24);
  if (visibleSearchResults.length === 0) {
    renderManagerMessage("没有匹配的行情品种", false);
    return;
  }
  visibleSearchResults.forEach(renderSearchProduct);
  void setMonitorLayout(visibleSearchResults.length);
}

async function ensureCatalog(force: boolean): Promise<Product[]> {
  if (catalogRequest) return catalogRequest;
  if (catalogState === "ready" && !force) return catalog;
  void ensureBackupSourceMappings(force);
  catalogState = "loading";
  renderManager();

  const fetchImpl = typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : null;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const catalogFetch = fetchProductCatalogSnapshot(fetchImpl
    ? (url, options) => fetchImpl(url, { ...options, signal: controller.signal })
    : null);
  const deadline = new Promise<never>((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("catalog request timed out"));
    }, 8_000);
  });
  catalogRequest = Promise.race([catalogFetch, deadline])
    .then((snapshot) => {
      const products = snapshot.products;
      if (products.length === 0) throw new Error("catalog is empty");
      catalog = applyBackupSourceMappings(products, backupSourceMappings);
      catalogState = "ready";
      const enriched = refreshProductsFromCatalog(selectedProducts, {
        ...snapshot,
        products: catalog,
      });
      const displayChanged = enriched.some((product, index) => (
        product.name !== selectedProducts[index].name
        || product.symbol !== selectedProducts[index].symbol
        || productQuoteCurrency(product) !== productQuoteCurrency(selectedProducts[index])
      ));
      const sourceCoverageBefore = sourceCoverageSignature(selectedProducts);
      selectedProducts = applyBackupSourceMappings(
        saveWatchlist(enriched),
        backupSourceMappings,
      );
      if (sourceCoverageSignature(selectedProducts) !== sourceCoverageBefore) {
        feed.setProducts(selectedProducts);
      }
      if (displayChanged) rebuildQuoteRows();
      renderManager();
      return catalog;
    })
    .catch(() => {
      catalogState = "error";
      renderManager();
      return [];
    })
    .finally(() => {
      clearTimeout(timeout!);
      controller.abort();
      catalogRequest = null;
    });
  return catalogRequest;
}

function backupCoverageSignature(products: Product[]): string {
  return products.map((product) => (
    `${product.id}\u0000${product.bitstampSymbol || ""}\u0000${product.bitfinexSymbol || ""}`
  )).join("\u0001");
}

function sourceCoverageSignature(products: Product[]): string {
  return products.map((product) => (
    `${product.id}\u0000${product.krakenSymbol || ""}\u0000${product.bitstampSymbol || ""}`
      + `\u0000${product.bitfinexSymbol || ""}\u0000${product.bybitSymbol || ""}`
      + `\u0000${product.gateSymbol || ""}`
  )).join("\u0001");
}

async function ensureBackupSourceMappings(force: boolean): Promise<BackupSourceMappings> {
  if (backupSourceMappingRequest) return backupSourceMappingRequest;
  if (backupSourceMappingState === "ready" && !force) return backupSourceMappings;

  const fetchImpl = typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : null;
  if (!fetchImpl) return backupSourceMappings;

  backupSourceMappingState = "loading";
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const mappingFetch = fetchBackupSourceMappings((url, options) => (
    fetchImpl(url, { ...options, signal: controller.signal })
  ));
  const deadline = new Promise<never>((resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("backup source directory request timed out"));
    }, 8_000);
  });

  backupSourceMappingRequest = Promise.race([mappingFetch, deadline])
    .then((mappings) => {
      if (!(mappings.bitstamp instanceof Map) && !(mappings.bitfinex instanceof Map)) {
        throw new Error("backup source directories are unavailable");
      }
      const before = backupCoverageSignature(selectedProducts);
      backupSourceMappings = {
        bitstamp: mappings.bitstamp instanceof Map
          ? mappings.bitstamp
          : backupSourceMappings.bitstamp,
        bitfinex: mappings.bitfinex instanceof Map
          ? mappings.bitfinex
          : backupSourceMappings.bitfinex,
      };
      selectedProducts = applyBackupSourceMappings(
        saveWatchlist(applyBackupSourceMappings(selectedProducts, backupSourceMappings)),
        backupSourceMappings,
      );
      if (catalogState === "ready") {
        catalog = applyBackupSourceMappings(catalog, backupSourceMappings);
      }
      backupSourceMappingState = "ready";
      if (backupCoverageSignature(selectedProducts) !== before) {
        feed.setProducts(selectedProducts);
      }
      renderManager();
      return backupSourceMappings;
    })
    .catch(() => {
      backupSourceMappingState = "error";
      return backupSourceMappings;
    })
    .finally(() => {
      clearTimeout(timeout!);
      backupSourceMappingRequest = null;
    });
  return backupSourceMappingRequest;
}

function openManager(): void {
  clearQuoteDrag();
  clearResizeDrag(true);
  managementOpen = true;
  updateResizeHandleVisibility();
  elements.quotes.hidden = true;
  elements.manager.hidden = false;
  updateQuoteOverflow();
  elements.watchlistButton.classList.add("is-open");
  elements.watchlistButton.setAttribute("aria-expanded", "true");
  elements.watchlistButton.setAttribute("aria-label", "返回价格列表");
  elements.search.value = "";
  renderManager();
  void ensureCatalog(false);
  requestAnimationFrame(() => {
    if (managementOpen && !elements.manager.hidden) elements.search.focus();
  });
}

function closeManager(restoreFocus: boolean): void {
  if (!managementOpen) return;
  managementOpen = false;
  updateResizeHandleVisibility();
  elements.manager.hidden = true;
  elements.quotes.hidden = false;
  elements.watchlistButton.classList.remove("is-open");
  elements.watchlistButton.setAttribute("aria-expanded", "false");
  elements.watchlistButton.setAttribute("aria-label", "添加或管理自选品种");
  elements.search.value = "";
  clearElement(elements.managerList);
  void setMonitorLayout(selectedProducts.length);
  requestAnimationFrame(updateQuoteOverflow);
  if (restoreFocus) elements.watchlistButton.focus();
}

function addProduct(product: Product): void {
  if (selectedProducts.some((entry) => entry.id === product.id)) return;

  selectedProducts = saveWatchlist(selectedProducts.concat([product]));
  feed.setProducts(selectedProducts);
  rebuildQuoteRows();
  announceManager(`已添加 ${product.symbol}`);
  closeManager(true);
}

function removeProduct(productId: string, previousIndex: number): void {
  const product = selectedProducts.find((entry) => entry.id === productId);
  if (!product || product.fixed) return;
  const previousRemovableIndex = selectedProducts
    .slice(0, previousIndex)
    .filter((entry) => !entry.fixed)
    .length;
  selectedProducts = saveWatchlist(selectedProducts.filter((entry) => entry.id !== productId));
  feed.setProducts(selectedProducts);
  rebuildQuoteRows();
  announceManager(`已删除 ${product.symbol}`);
  renderManager();
  requestAnimationFrame(() => {
    if (!managementOpen || elements.manager.hidden) return;
    const buttons = elements.managerList.querySelectorAll<HTMLButtonElement>(".manager-remove");
    if (buttons.length > 0) {
      const targetIndex = Math.min(previousRemovableIndex, buttons.length - 1);
      if (buttons[targetIndex].isConnected) buttons[targetIndex].focus();
    } else {
      elements.search.focus();
    }
  });
}

elements.watchlistButton.addEventListener("click", () => {
  if (managementOpen) closeManager(true);
  else openManager();
});

elements.search.addEventListener("input", renderManager);
elements.search.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && elements.search.value.trim()) {
    const firstAvailable = visibleSearchResults.find((product) => (
      !selectedProducts.some((entry) => entry.id === product.id)
    ));
    if (firstAvailable) {
      event.preventDefault();
      addProduct(firstAvailable);
    }
  }
});

elements.manager.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeManager(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const targets = [
    elements.search,
    ...Array.from(elements.manager.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")),
  ] as HTMLElement[];
  const currentIndex = targets.indexOf(document.activeElement as HTMLElement);
  if (currentIndex < 0) return;
  const step = event.key === "ArrowDown" ? 1 : -1;
  const nextIndex = Math.min(Math.max(0, currentIndex + step), targets.length - 1);
  if (nextIndex !== currentIndex) {
    event.preventDefault();
    targets[nextIndex].focus();
  }
});

elements.quotes.addEventListener("dragstart", (event) => {
  const row = quoteRowFromEvent(event);
  const productId = row?.dataset.productId;
  if (!row || !productId || managementOpen) {
    event.preventDefault();
    return;
  }
  quoteDrag = { productId, row };
  elements.quotes.classList.add("is-reordering");
  row.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", productId);
  }
});

elements.quotes.addEventListener("dragover", (event) => {
  if (!quoteDrag) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

  const row = quoteRowFromEvent(event);
  if (!row || row.dataset.productId === quoteDrag.productId) {
    clearQuoteDropIndicator();
  } else {
    const bounds = row.getBoundingClientRect();
    setQuoteDropIndicator(row, event.clientY >= bounds.top + bounds.height / 2);
  }

  const bounds = elements.quotes.getBoundingClientRect();
  const edge = Math.min(28, bounds.height / 3);
  if (event.clientY < bounds.top + edge) elements.quotes.scrollTop -= 16;
  else if (event.clientY > bounds.bottom - edge) elements.quotes.scrollTop += 16;
});

elements.quotes.addEventListener("dragleave", (event) => {
  const row = quoteRowFromEvent(event);
  if (!row || quoteDrop?.row !== row) return;
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
  clearQuoteDropIndicator();
});

elements.quotes.addEventListener("drop", (event) => {
  if (!quoteDrag) return;
  event.preventDefault();
  event.stopPropagation();
  const row = quoteRowFromEvent(event);
  const targetProductId = row?.dataset.productId;
  const movingProductId = quoteDrag.productId;
  if (!row || !targetProductId || targetProductId === movingProductId) {
    clearQuoteDrag();
    return;
  }
  const placeAfter = quoteDrop?.row === row
    ? quoteDrop.placeAfter
    : event.clientY >= row.getBoundingClientRect().top + row.offsetHeight / 2;
  clearQuoteDrag();
  if (reorderSelectedProduct(movingProductId, targetProductId, placeAfter)) {
    requestAnimationFrame(() => quoteViews.get(movingProductId)?.row.focus());
  }
});

elements.quotes.addEventListener("dragend", clearQuoteDrag);

elements.quotes.addEventListener("keydown", (event) => {
  const row = quoteRowFromEvent(event);
  const productId = row?.dataset.productId;
  if (
    productId
    && event.altKey
    && (event.key === "ArrowDown" || event.key === "ArrowUp")
  ) {
    event.preventDefault();
    event.stopPropagation();
    moveSelectedProductBy(productId, event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  elements.quotes.scrollTop += event.key === "ArrowDown" ? 33 : -33;
});

document.addEventListener("dragover", (event) => {
  if (!quoteDrag) event.preventDefault();
});

document.addEventListener("drop", (event) => {
  if (!quoteDrag) {
    event.preventDefault();
    return;
  }
  if (!(event.target instanceof Node) || !elements.quotes.contains(event.target)) {
    event.preventDefault();
    clearQuoteDrag();
  }
});

function beginResizeDrag(clientY: number, pointerId: number | null): void {
  resizeDrag = {
    startHeight: globalThis.innerHeight,
    startClientY: clientY,
    pointerId,
  };
  elements.monitor.classList.add("is-resizing");
}

if ("PointerEvent" in globalThis) {
  elements.resizeHandle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !event.isPrimary || managementOpen || selectedProducts.length <= 4) {
      return;
    }
    event.preventDefault();
    beginResizeDrag(event.clientY, event.pointerId);
    elements.resizeHandle.setPointerCapture(event.pointerId);
  });

  elements.resizeHandle.addEventListener("pointermove", (event) => {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const height = resizeHeightAt(event.clientY);
    if (height !== null) queueMonitorHeight(height);
  });

  elements.resizeHandle.addEventListener("pointerup", (event) => {
    if (!resizeDrag || resizeDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const height = resizeHeightAt(event.clientY);
    if (height !== null) queueMonitorHeight(height);
    if (elements.resizeHandle.hasPointerCapture(event.pointerId)) {
      elements.resizeHandle.releasePointerCapture(event.pointerId);
    }
    clearResizeDrag(false);
  });

  elements.resizeHandle.addEventListener("pointercancel", () => clearResizeDrag(false));
  elements.resizeHandle.addEventListener("lostpointercapture", (event) => {
    if (resizeDrag?.pointerId === event.pointerId) clearResizeDrag(false);
  });
} else {
  elements.resizeHandle.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || managementOpen || selectedProducts.length <= 4) return;
    event.preventDefault();
    beginResizeDrag(event.clientY, null);
  });

  globalThis.addEventListener("mousemove", (event) => {
    if (!resizeDrag) return;
    if ((event.buttons & 1) === 0) {
      clearResizeDrag(false);
      return;
    }
    event.preventDefault();
    const height = resizeHeightAt(event.clientY);
    if (height !== null) queueMonitorHeight(height);
  });

  globalThis.addEventListener("mouseup", (event) => {
    if (!resizeDrag || event.button !== 0) return;
    event.preventDefault();
    const height = resizeHeightAt(event.clientY);
    if (height !== null) queueMonitorHeight(height);
    clearResizeDrag(false);
  });
}

elements.resizeHandle.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  queueMonitorHeight(globalThis.innerHeight + (event.key === "ArrowDown" ? 33 : -33));
});

globalThis.addEventListener("blur", () => {
  clearQuoteDrag();
  clearResizeDrag(false);
});

globalThis.addEventListener("resize", updateQuoteOverflow);

elements.close.addEventListener("click", () => {
  closeManager(false);
  void tauriInvoke("close_window");
});

rebuildQuoteRows();
const feed = new PriceFeed({ products: selectedProducts });
feed.subscribe(queueRender);
feed.start();
void ensureBackupSourceMappings(false);

globalThis.addEventListener("online", () => {
  feed.reconnectAll();
  void ensureBackupSourceMappings(true);
});
globalThis.addEventListener("offline", () => queueRender(feed.getState()));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    feed.reconnectAll();
  } else {
    clearQuoteDrag();
    closeManager(false);
  }
});
globalThis.addEventListener("beforeunload", () => feed.stop(), { once: true });

setInterval(() => {
  if (latestState) renderUpdateTime(latestState.lastUpdateAt);
}, 1_000);

setInterval(() => {
  void tauriInvoke("ensure_always_on_top");
}, 10_000);
