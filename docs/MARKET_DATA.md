# Market Data Architecture

This is the authoritative developer reference for product discovery, price-source selection, UTC+0 change, and provider-specific constraints.

## Invariants

- Crypto spot products are real fiat-USD pairs. USDT, USDC, stablecoin bundles, and converted reference prices must never be presented as USD spot.
- Stock-related products are a separately approved class of USDT-settled perpetual derivatives. They must remain visibly identified as `.P` / `USDT永续`; they are not direct shares or evidence of stock ownership.
- Public data must remain free and usable without asking the user for an API key.
- Price updates should use WebSocket pushes. REST is limited to product discovery, UTC-open lookup, and current-price fallback.
- The displayed price and UTC-day open must have the same `marketSource` and exact product. Never borrow an underlying stock price, another exchange's open, or another contract's symbol.
- UTC change is `(current / open - 1) * 100`, where `open` is the displayed exchange product's current `00:00 UTC` calendar-day open. It is not rolling 24-hour change.
- Exchange symbols are exact official mappings. Never construct another provider's pair from a base ticker or assume aliases are equivalent.

## Product discovery and mappings

`src/watchlist.ts` loads three keyless catalogs independently and merges any valid results:

- Coinbase `/products` plus `/currencies`: accept only online, tradeable `*-USD` crypto spot products and sanitize remote names.
- Bybit V5 linear instruments: accept only `symbolType=stock`, `marketRegion=US`, `contractType=LinearPerpetual`, `status=Trading`, and USDT quote/settlement. Use the official `underlyingTicker`, `symbol`, and `fullName`.
- Gate USDT futures contracts: accept only `contract_type=stocks`, `status=trading`, and non-delisting contracts. Use the official contract base and full contract name exactly.

The canonical derivative ID is `{TICKER}-USDT-PERP`, displayed as `{TICKER}.P`. Bybit and Gate entries merge only when their canonical ticker is exactly equal; `AAPL` is never guessed to be `AAPLX`. Gate-only and Bybit-only stock-related contracts remain independently searchable. A merged entry keeps Bybit's official full name when available and retains both exact provider symbols.

Catalog requests have a bounded optional-source timeout. Coinbase, Bybit, or Gate can independently supply a usable catalog; the manager fails only if every product directory is unavailable or empty. If one stock directory fails transiently, refreshing metadata preserves the selected product's last validated symbol for that source. A successful directory response is authoritative for mappings on products also present through another provider.

Live research snapshot from 2026-08-29, recorded only as validation evidence rather than a constant: Bybit returned 168 stock-class instruments and 150 passed the strict U.S./USDT filters; Gate returned 370 active non-delisting stock-class contracts; 118 canonical tickers matched exactly across both. Provider listings change, so runtime code always consumes the current catalogs.

Provider coverage is intentionally asymmetric:

| Provider | Products | Mapping source |
| --- | --- | --- |
| Coinbase | Every selected USD crypto spot product | The exact Coinbase product ID |
| Kraken | BTC/ETH USD spot currently | Built-in, verified `BTC/USD` and `ETH/USD` mappings |
| Bitstamp | BTC/ETH plus exact USD-spot catalog intersections | Built-in defaults, then `/api/v2/markets/` filtered to enabled USD spot |
| Bitfinex | BTC/ETH USD spot currently | Built-in, verified `tBTCUSD` and `tETHUSD`; no runtime REST directory because its REST origin lacks WebView CORS |
| Bybit | Strictly filtered U.S. stock-related USDT perpetuals in its live directory | Official `underlyingTicker` and `symbol` |
| Gate | Active stock-class USDT perpetuals in its live directory | Official contract base/name; exact ticker equality only when merged with Bybit |

Stored fields are syntax-validated and product-class validated before reuse. Gate mappings must also equal the canonical ticker. Bybit mappings may differ from the underlying ticker and therefore remain the exact official symbol captured from its directory rather than a reconstructed string.

## Provider transports

### Coinbase

- Price: `wss://advanced-trade-ws.coinbase.com`, dynamic `ticker` subscription for selected USD-spot IDs plus `heartbeats`.
- Current-price fallback: `https://api.exchange.coinbase.com/products/{productId}/ticker`.
- Catalog: `https://api.exchange.coinbase.com/products` and `/currencies`.
- UTC open: one-hour Exchange candles from current UTC midnight through now; sort/filter and use the earliest returned candle's open.
- Coinbase REST quotes retain `marketSource: "coinbase"` while using `source: "coinbaseRest"`.
- REST freshness uses the ticker payload's last-trade `time`, not HTTP receipt time, so an old quiet-market trade cannot look newly received.

### Kraken

- Price: `wss://ws.kraken.com/v2`, ticker updates triggered by trades; the connection sends application-level ping messages.
- Current coverage: exact built-in BTC/USD and ETH/USD mappings only.
- UTC open: one combined `https://api.kraken.com/0/public/Ticker` request for missing mapped products; field `o` is Kraken's UTC-day open.

### Bitstamp

- Price: `wss://ws.bitstamp.net`, one `live_trades_{market_symbol}` subscription per exact mapping.
- Trade payloads may expose `price_str` or `price`; prefer the microsecond exchange timestamp.
- UTC open: `/api/v2/ohlc/{market}/?step=3600&limit=24&start=...&end=...`; select the earliest current-day candle with a positive open and `volume > 0` so an empty fill bucket cannot become the daily open.
- Markets/OHLC are browser-fetched and therefore depend on platform WebView CORS behavior. Do not add wildcard CSP permissions as a workaround.

### Bitfinex

- Price and UTC open share `wss://api-pub.bitfinex.com/ws/2`.
- Each mapped product subscribes to `trades` and `candles` key `trade:1D:{symbol}`. Current built-in BTC/ETH coverage uses four channels. Any future expansion of exact Bitfinex mappings must partition connections as needed to respect the provider's per-socket channel limit; the watchlist itself no longer supplies an eight-product safety bound.
- Bind dynamic `chanId` values from subscription acknowledgements. Trade snapshots may be newest-first; select maximum MTS. Handle `te`, `tu`, and `[chanId,"hb"]` correctly.
- Every expected trade/candle subscription must receive a unique acknowledgement. A rejection or 10-second incomplete-ACK timeout closes the socket and enters normal reconnect backoff.
- Candle control/data events must not update trade freshness. Accept a UTC open only when its MTS equals current UTC midnight and volume is positive.
- Bitfinex REST was rejected for the WebView path because its public REST responses did not provide the required Tauri-origin CORS header. CSP intentionally allows its WSS origin but not its HTTPS REST origin.

### Bybit stock-related perpetuals

- Catalog: `https://api.bybit.com/v5/market/instruments-info?category=linear&symbolType=stock&status=Trading&limit=1000` with the strict metadata filters above.
- Price: `wss://stream.bybit.com/v5/public/linear`, one exact `tickers.{symbol}` argument per selected Bybit product.
- The socket must acknowledge the subscription; a rejection or 10-second ACK timeout reconnects. Application ping messages keep the public connection active.
- Current-price fallback: `/v5/market/tickers?category=linear&symbol={symbol}`. REST quotes retain `marketSource: "bybit"` with `source: "bybitRest"`.
- UTC open: `/v5/market/kline?category=linear&symbol={symbol}&interval=D&start=...&end=...&limit=2`; accept only a candle whose start equals current UTC midnight exactly.

### Gate stock-related perpetuals

- Catalog: `https://api.gateio.ws/api/v4/futures/usdt/contracts`, filtered to active non-delisting stock-class contracts.
- Price: `wss://fx-ws.gateio.ws/v4/ws/usdt`, channel `futures.tickers` with exact contract names. The subscription payload timestamp is generated when each socket opens rather than cached at construction.
- The socket must acknowledge the subscription; a rejection or 10-second ACK timeout reconnects.
- Current-price fallback: `/api/v4/futures/usdt/tickers?contract={contract}`. REST quotes retain `marketSource: "gate"` with `source: "gateRest"`.
- UTC open: `/api/v4/futures/usdt/candlesticks?contract={contract}&interval=1d&from=...&to=...`; accept only a candle whose `t` equals current UTC midnight exactly.

## Selection and stale behavior

For each product, `selectQuote` applies this order:

1. Its preferred primary WebSocket within 5 seconds: Coinbase for USD spot, or Bybit when that stock-related product has an exact Bybit mapping.
2. The newest supported WebSocket quote within 12 seconds.
3. The newest supported Coinbase/Bybit/Gate REST quote within 12 seconds.
4. Otherwise preserve the newest last quote and mark it stale.

A Gate-only product naturally begins at step 2. REST must never temporarily outrank a healthy real-time socket. The UI status is `live` only when every selected product is fresh; otherwise it becomes `partial`, `reconnecting`, `connecting`, or `offline` according to product/source state.

Source freshness is measured with `receivedAt`. UTC-day membership is measured with exchange event time `exchangeAt`; local time zones and network delay must not choose the day. A Bitfinex trade snapshot deliberately uses its trade MTS as freshness rather than the new connection's receipt time, so an old snapshot cannot masquerade as a current tick.

## Failure handling

- Socket handshake timeout: 12 seconds.
- Coinbase/Kraken transport idle timeout: 10 seconds; BTC/ETH ticker sentinel timeout: 20 seconds.
- Bitstamp/Bitfinex idle and fixed-product ticker sentinel timeout: 30 seconds.
- Bybit/Gate idle timeout: 35 seconds; stock-related products become stale and use REST rather than acting as shared-socket sentinels.
- Subscription ACK timeout for Bybit, Gate, and Bitfinex: 10 seconds.
- Reconnect: jittered exponential delay starting near 500ms and capped at 30 seconds.
- Only fixed BTC/ETH act as shared-socket ticker sentinels. A quiet custom product becomes stale or uses REST; it must not force every product's shared socket into a reconnect loop.
- Current-price fallback checks every 5 seconds and requests exact supported products only when no fresh WebSocket quote exists. A product with exact Bybit and Gate mappings can query both fallbacks independently.
- REST batches are capped at three concurrent requests across the requested source/product work; one product failure must not discard successful siblings.
- UTC-open requests have an 8-second abort deadline and per-product retry delay of roughly 2/4/8/16/32/60 seconds. Missing products re-enter a source-specific pending queue and retry even without another quote.
- REST UTC-open data is requested only for the source currently selected for each product. Do not prefetch every available source at startup; that creates unnecessary free-API bursts and unused cross-source state.
- UTC midnight invalidates the previous day's open immediately, including when no new ticker has arrived. Display `—` until a current-day same-source open exists.
- `setProducts` aborts old requests and uses a revision guard so removed products cannot be written back by late responses.
- When capturing browser `fetch` for `PriceFeed` or catalog work, bind it to `globalThis`. Passing an unbound WebView fetch function caused an illegal-receiver failure on Windows and is covered by a regression test.

## Adding or changing a source

Before production use:

1. Confirm with current official documentation that data is public, keyless, and belongs to an explicitly approved product/quote semantic. Crypto spot remains true USD only.
2. Verify the exact product/instrument catalog and product class; do not infer pair strings or aliases.
3. Test from the target Tauri WebView origin, not only curl/Node, for CORS and TLS behavior.
4. Add only the exact HTTPS/WSS origins to CSP.
5. Define exchange timestamps, heartbeat/ACK behavior, stale thresholds, and reconnect semantics.
6. Define a same-source UTC-day open or explicitly show `—`; never borrow another exchange or underlying's open.
7. Add parser, malformed-message, source-selection, timeout/reconnect, UTC rollover, mapping, and persistence-refresh tests.
8. Recheck provider licensing and regional eligibility before commercial redistribution.
