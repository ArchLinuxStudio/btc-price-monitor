import {
  createExactPriceSocket,
  parseBybitRestTicker,
  parseGateRestTicker,
  parseRestTicker,
  selectQuote,
} from "./price-feed.js";
import type {
  ExactPriceSocket,
  ExactPriceSource,
  FetchImpl,
  MarketSource,
  Quote,
  WebSocketConstructor,
} from "./price-feed.js";
import type { Product } from "./watchlist.js";

export interface ChartCurrentPriceState {
  quote: Quote | null;
  stale: boolean;
}

export interface ChartCurrentPriceOptions {
  product: Product;
  marketSource: MarketSource | null | undefined;
  onChange: (state: ChartCurrentPriceState) => void;
  WebSocketImpl?: WebSocketConstructor;
  fetchImpl?: FetchImpl | null;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => () => void;
}

const STALE_AFTER_MS = 12_000;
const FALLBACK_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 8_000;

/** One visible chart's exact-source last price; it never changes historical OHLC. */
export class ChartCurrentPrice {
  private readonly product: Product;
  private readonly marketSource: ExactPriceSource;
  private readonly socket: ExactPriceSocket;
  private readonly fetchImpl: FetchImpl | null;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delay: number) => () => void;
  private readonly onChange: (state: ChartCurrentPriceState) => void;
  private started = false;
  private revision = 0;
  private wsQuote: Quote | null = null;
  private restQuote: Quote | null = null;
  private lastState: ChartCurrentPriceState = { quote: null, stale: true };
  private cancelTick: (() => void) | null = null;
  private cancelTimeout: (() => void) | null = null;
  private request: AbortController | null = null;
  private nextFallbackAt = 0;

  constructor({
    product,
    marketSource,
    onChange,
    WebSocketImpl,
    fetchImpl = typeof globalThis.fetch === "function"
      ? globalThis.fetch.bind(globalThis) as FetchImpl
      : null,
    now = () => Date.now(),
    schedule = (callback, delay) => {
      const timer = setTimeout(callback, delay);
      return () => clearTimeout(timer);
    },
  }: ChartCurrentPriceOptions) {
    this.product = { ...product };
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.schedule = schedule;
    this.onChange = onChange;
    this.socket = createExactPriceSocket({
      product: this.product,
      marketSource,
      WebSocketImpl,
      now,
      onQuotes: (quotes) => {
        if (!this.started) return;
        for (const quote of quotes) {
          if (!this.wsQuote || quote.exchangeAt >= this.wsQuote.exchangeAt) this.wsQuote = quote;
        }
        this.emit();
      },
    });
    // The exact socket factory validates both source and product before use.
    this.marketSource = marketSource as ExactPriceSource;
  }

  get state(): ChartCurrentPriceState {
    const selected = selectQuote<Quote>({
      [this.marketSource]: this.wsQuote,
      [`${this.marketSource}Rest`]: this.restQuote,
    }, this.now());
    if (!selected) return { quote: null, stale: true };
    const { stale, ...quote } = selected;
    return { quote, stale };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.revision += 1;
    this.wsQuote = null;
    this.restQuote = null;
    this.nextFallbackAt = 0;
    this.emit();
    this.socket.start();
    void this.pollFallback();
    this.scheduleTick();
  }

  stop(): void {
    this.started = false;
    this.revision += 1;
    this.cancelTick?.();
    this.cancelTick = null;
    this.cancelTimeout?.();
    this.cancelTimeout = null;
    this.request?.abort();
    this.request = null;
    this.socket.stop();
    this.wsQuote = null;
    this.restQuote = null;
    this.emit();
  }

  private emit(): void {
    const state = this.state;
    const previous = this.lastState;
    if (state.stale === previous.stale && state.quote?.source === previous.quote?.source
      && state.quote?.price === previous.quote?.price
      && state.quote?.receivedAt === previous.quote?.receivedAt
      && state.quote?.exchangeAt === previous.quote?.exchangeAt) return;
    this.lastState = state;
    this.onChange(state);
  }

  private scheduleTick(): void {
    if (!this.started) return;
    this.cancelTick = this.schedule(() => {
      this.cancelTick = null;
      if (!this.started) return;
      this.emit();
      void this.pollFallback();
      this.scheduleTick();
    }, 1_000);
  }

  private async pollFallback(): Promise<void> {
    if (!this.started || !this.fetchImpl || this.request || this.now() < this.nextFallbackAt) return;
    if (this.wsQuote && this.now() - this.wsQuote.receivedAt <= STALE_AFTER_MS) return;
    const revision = this.revision;
    const controller = new AbortController();
    this.request = controller;
    this.nextFallbackAt = this.now() + FALLBACK_INTERVAL_MS;
    const cancelTimeout = this.schedule(() => controller.abort(), REQUEST_TIMEOUT_MS);
    this.cancelTimeout = cancelTimeout;
    const url = this.marketSource === "coinbase"
      ? `https://api.exchange.coinbase.com/products/${encodeURIComponent(this.product.id)}/ticker`
      : this.marketSource === "bybit"
        ? `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(this.product.bybitSymbol!)}`
        : `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${encodeURIComponent(this.product.gateSymbol!)}`;
    try {
      const fetchedAt = this.now();
      const response = await this.fetchImpl(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!this.started || revision !== this.revision || controller.signal.aborted) return;
      if (!response.ok) {
        const cooldown = response.status === 403 ? 600_000 : response.status === 429 ? 60_000 : 0;
        this.nextFallbackAt = Math.max(this.nextFallbackAt, this.now() + cooldown);
        return;
      }
      const payload = await response.json();
      if (!this.started || revision !== this.revision || controller.signal.aborted) return;
      const quote = this.marketSource === "coinbase"
        ? parseRestTicker(this.product.id, payload, fetchedAt)
        : this.marketSource === "bybit"
          ? parseBybitRestTicker(this.product.id, payload, fetchedAt, this.product.bybitSymbol!)
          : parseGateRestTicker(this.product.id, payload, fetchedAt, this.product.gateSymbol!);
      if (quote && (!this.restQuote || quote.exchangeAt >= this.restQuote.exchangeAt)) {
        this.restQuote = quote;
        this.emit();
      }
    } catch {
      // Keep the last known quote; the clock marks it stale without inventing a price.
    } finally {
      cancelTimeout();
      if (this.cancelTimeout === cancelTimeout) this.cancelTimeout = null;
      if (this.request === controller) this.request = null;
    }
  }
}
