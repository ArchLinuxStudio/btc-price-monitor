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
  live: "实时",
  partial: "部分数据",
  connecting: "连接中",
  reconnecting: "重连中",
  offline: "离线",
};

const previousPrices = { BTC: null, ETH: null };
const priceAnimations = { BTC: null, ETH: null };
let latestState = null;
let pendingState = null;
let renderScheduled = false;
let lastRenderAt = 0;
let lastDataSecond = null;

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

function render(state) {
  const status = statusLabels[state.status] ? state.status : "offline";
  elements.liveDot.className = `live-dot is-${status}`;
  elements.statusText.textContent = statusLabels[status];

  const sources = new Set();
  for (const asset of ["BTC", "ETH"]) {
    const quote = state.prices[asset];
    renderQuote(asset, quote);
    if (quote && quote.sourceLabel) sources.add(quote.sourceLabel);
  }
  elements.sourceLabel.textContent = sources.size > 0
    ? [...sources].join(" / ")
    : "Coinbase + Kraken";
  const dataSecond = state.lastUpdateAt ? Math.floor(state.lastUpdateAt / 1_000) : null;
  if (dataSecond !== lastDataSecond) {
    lastDataSecond = dataSecond;
    renderUpdateTime(state.lastUpdateAt);
  }
}

function renderQuote(asset, quote) {
  const view = elements[asset];
  if (!quote) {
    view.price.textContent = "$—";
    view.change.textContent = "24h —";
    view.change.className = "change neutral";
    view.row.classList.add("is-stale");
    return;
  }

  const previous = previousPrices[asset];
  view.price.textContent = `$${priceFormatter.format(quote.price)}`;
  view.row.classList.toggle("is-stale", quote.stale);

  if (quote.change24h === null) {
    view.change.textContent = "24h —";
    view.change.className = "change neutral";
  } else {
    const direction = quote.change24h > 0 ? "up" : quote.change24h < 0 ? "down" : "neutral";
    const sign = quote.change24h > 0 ? "+" : "";
    view.change.textContent = `24h ${sign}${quote.change24h.toFixed(2)}%`;
    view.change.className = `change ${direction}`;
  }

  if (previous !== null && quote.price !== previous) {
    const tickColor = quote.price > previous ? "#4ce2a4" : "#ff747d";
    if (priceAnimations[asset]) priceAnimations[asset].cancel();
    if (typeof view.price.animate === "function") {
      priceAnimations[asset] = view.price.animate(
        [
          { color: tickColor, textShadow: `0 0 10px ${tickColor}55` },
          { color: "#f8f9fc", textShadow: "none" },
        ],
        { duration: 420, easing: "ease-out" },
      );
    }
  }
  previousPrices[asset] = quote.price;
}

function renderUpdateTime(lastUpdateAt) {
  if (!lastUpdateAt) {
    elements.updateTime.textContent = "等待首笔行情…";
    return;
  }

  const ageSeconds = Math.max(0, Math.floor((Date.now() - lastUpdateAt) / 1_000));
  const clock = new Date(lastUpdateAt).toLocaleTimeString("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const age = ageSeconds < 2 ? "刚刚" : `${ageSeconds} 秒前`;
  elements.updateTime.textContent = `${clock} · ${age}`;
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
