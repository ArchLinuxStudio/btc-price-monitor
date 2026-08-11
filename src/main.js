import { PriceFeed } from "./price-feed.js";

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const elements = {
  liveDot: document.querySelector("#live-dot"),
  statusText: document.querySelector("#status-text"),
  sourceLabel: document.querySelector("#source-label"),
  updateTime: document.querySelector("#update-time"),
  minimize: document.querySelector("#minimize-button"),
  close: document.querySelector("#close-button"),
  BTC: {
    row: document.querySelector("#btc-row"),
    price: document.querySelector("#btc-price"),
    change: document.querySelector("#btc-change"),
  },
  ETH: {
    row: document.querySelector("#eth-row"),
    price: document.querySelector("#eth-price"),
    change: document.querySelector("#eth-change"),
  },
};

const statusLabels = {
  live: { compact: "LIVE", full: "实时行情" },
  partial: { compact: "PART", full: "部分行情可用" },
  connecting: { compact: "LINK", full: "正在连接行情" },
  reconnecting: { compact: "RETRY", full: "正在重新连接" },
  offline: { compact: "OFF", full: "行情离线" },
};

const sourceLabels = {
  Coinbase: "Coinbase",
  Kraken: "Kraken",
  "Coinbase REST": "REST",
};

const sourceAbbreviations = {
  Coinbase: "CB",
  Kraken: "KR",
  "Coinbase REST": "REST",
};

const previousPrices = { BTC: null, ETH: null };
const priceAnimations = { BTC: null, ETH: null };
let latestState = null;
let pendingState = null;
let renderScheduled = false;
let lastRenderAt = 0;
let lastDataSecond = null;

function prefersReducedMotion() {
  return typeof globalThis.matchMedia === "function"
    && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function queueRender(state) {
  pendingState = state;
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(function drainFrame(frameTime) {
    if (frameTime - lastRenderAt < 33) {
      requestAnimationFrame(drainFrame);
      return;
    }
    renderScheduled = false;
    lastRenderAt = frameTime;
    latestState = pendingState;
    pendingState = null;
    render(latestState);
  });
}

function compactSourceLabel(sources) {
  if (sources.length === 0) return "Coinbase";
  if (sources.length === 1) return sourceLabels[sources[0]] || sources[0];
  return sources.map((source) => sourceAbbreviations[source] || source).join("/");
}

function render(state) {
  const status = statusLabels[state.status] ? state.status : "offline";
  const statusLabel = statusLabels[status];
  elements.liveDot.className = `live-dot is-${status}`;
  elements.statusText.textContent = statusLabel.compact;
  elements.statusText.title = statusLabel.full;
  elements.statusText.setAttribute("aria-label", statusLabel.full);

  const sources = new Set();
  for (const asset of ["BTC", "ETH"]) {
    const quote = state.prices[asset];
    renderQuote(asset, quote);
    if (quote && quote.sourceLabel) sources.add(quote.sourceLabel);
  }

  const sourceList = Array.from(sources);
  elements.sourceLabel.textContent = compactSourceLabel(sourceList);
  elements.sourceLabel.title = sourceList.length > 0
    ? sourceList.join(" / ")
    : "等待 Coinbase 或 Kraken 行情";

  const dataSecond = state.lastUpdateAt ? Math.floor(state.lastUpdateAt / 1_000) : null;
  if (dataSecond !== lastDataSecond) {
    lastDataSecond = dataSecond;
    renderUpdateTime(state.lastUpdateAt);
  }
}

function renderQuote(asset, quote) {
  const view = elements[asset];
  if (!quote) {
    view.price.textContent = "—";
    view.price.removeAttribute("title");
    view.change.textContent = "—";
    view.change.className = "change neutral";
    view.change.setAttribute("aria-label", `${asset} 当日涨跌尚不可用`);
    view.row.classList.add("is-stale");
    previousPrices[asset] = null;
    return;
  }

  const previous = previousPrices[asset];
  const formattedPrice = priceFormatter.format(quote.price);
  view.price.textContent = formattedPrice;
  view.price.title = `${asset} $${formattedPrice} USD`;
  view.row.classList.toggle("is-stale", quote.stale);

  if (quote.changeUtc === null) {
    view.change.textContent = "—";
    view.change.className = "change neutral";
    view.change.setAttribute("aria-label", `${asset} 相对当天 00:00 UTC 的涨跌尚不可用`);
  } else {
    const direction = quote.changeUtc > 0 ? "up" : quote.changeUtc < 0 ? "down" : "neutral";
    const sign = quote.changeUtc > 0 ? "+" : quote.changeUtc < 0 ? "−" : "";
    const changeText = `${sign}${Math.abs(quote.changeUtc).toFixed(2)}%`;
    view.change.textContent = changeText;
    view.change.className = `change ${direction}`;
    view.change.setAttribute(
      "aria-label",
      `${asset} 相对当天 00:00 UTC ${quote.changeUtc >= 0 ? "上涨" : "下跌"} ${Math.abs(quote.changeUtc).toFixed(2)}%`,
    );
  }

  if (previous !== null && quote.price !== previous && !prefersReducedMotion()) {
    const tickColor = quote.price > previous ? "#3dd49a" : "#f16b75";
    if (priceAnimations[asset]) priceAnimations[asset].cancel();
    if (typeof view.price.animate === "function") {
      priceAnimations[asset] = view.price.animate(
        [{ color: tickColor }, { color: "#f3f5f8" }],
        { duration: 200, easing: "ease-out" },
      );
    }
  }
  previousPrices[asset] = quote.price;
}

function renderUpdateTime(lastUpdateAt) {
  if (!lastUpdateAt) {
    elements.updateTime.textContent = "等待首笔行情";
    return;
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastUpdateAt) / 1_000));
  const age = ageSeconds < 2 ? "刚刚" : `${ageSeconds} 秒前`;
  elements.updateTime.textContent = `行情最后更新于${age}`;
}

function tauriInvoke(command) {
  const tauri = globalThis.__TAURI__;
  const invoke = tauri && tauri.core && tauri.core.invoke;
  return invoke ? invoke(command) : Promise.resolve();
}

elements.minimize.addEventListener("click", () => {
  void tauriInvoke("minimize_window");
});

elements.close.addEventListener("click", () => {
  void tauriInvoke("close_window");
});

const feed = new PriceFeed();
feed.subscribe(queueRender);
feed.start();

globalThis.addEventListener("online", () => feed.reconnectAll());
globalThis.addEventListener("offline", () => queueRender(feed.getState()));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") feed.reconnectAll();
});
globalThis.addEventListener("beforeunload", () => feed.stop(), { once: true });

setInterval(() => {
  if (latestState) renderUpdateTime(latestState.lastUpdateAt);
}, 1_000);

setInterval(() => {
  void tauriInvoke("ensure_always_on_top");
}, 10_000);
