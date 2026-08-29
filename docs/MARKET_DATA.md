# Market Data Architecture

This is the authoritative developer reference for product discovery, price-source selection, UTC+0 change, and provider-specific constraints.

## Invariants

- All displayed pairs are real fiat USD pairs. USDT, USDC, stablecoin bundles, or unlabeled converted reference prices are not interchangeable with USD.
- Public data must remain free and usable without asking the user for an API key.
- Price updates should use WebSocket pushes. REST is limited to product discovery, UTC-open lookup, and current-price fallback.
- The displayed price and UTC-day open must have the same `marketSource` and product. Never calculate a cross-exchange change.
- UTC change is `(current / open - 1) * 100`, where `open` is the first valid same-exchange trading open at or after `00:00 UTC`; it is not rolling 24-hour change.
- Exchange symbols are exact mappings. Never derive a Kraken, Bitstamp, or Bitfinex pair by concatenating a Coinbase base symbol.

## Product discovery and mappings

Coinbase online `*-USD` spot products are the selectable catalog. `src/watchlist.ts` loads `/products` plus `/currencies`, accepts only online and tradeable real-USD products, and sanitizes remote names.

Provider coverage is intentionally asymmetric:

| Provider | Products | Mapping source |
| --- | --- | --- |
| Coinbase | Every selected product | The unified product ID itself |
| Kraken | BTC/ETH currently | Built-in, verified `BTC/USD` and `ETH/USD` mappings |
| Bitstamp | BTC/ETH plus exact catalog intersections | Built-in defaults, then `/api/v2/markets/` filtered to `counter_currency=USD`, `market_type=SPOT`, `trading=Enabled` |
| Bitfinex | BTC/ETH currently | Built-in, verified `tBTCUSD` and `tETHUSD`; no runtime REST catalog because its REST origin lacks WebView CORS |

An optional directory failure must not block Coinbase catalog/search. A successful Bitstamp refresh is authoritative and may remove a delisted mapping; a failed refresh preserves the last validated mapping for that run/persisted custom product. Stored mapping fields are validated against the product base and exact USD quote before reuse.

`parseBitfinexPairs` is a tested pure parser for exact official pair data, but the runtime does not currently fetch a Bitfinex REST directory. Its presence is not permission to guess custom symbols.

## Provider transports

### Coinbase

- Price: `wss://advanced-trade-ws.coinbase.com`, dynamic `ticker` subscription for all selected product IDs plus `heartbeats`.
- Current-price fallback: `https://api.exchange.coinbase.com/products/{productId}/ticker`.
- Catalog: `https://api.exchange.coinbase.com/products` and `/currencies`.
- UTC open: one-hour Exchange candles from current UTC midnight through now; sort/filter and use the earliest returned candle's `open`.
- Coinbase REST quotes retain `marketSource: "coinbase"` while using `source: "coinbaseRest"`.
- Coinbase REST freshness uses the ticker payload's last-trade `time`, not HTTP receipt time; otherwise a quiet market's old trade would look newly received.

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
- Each mapped product subscribes to `trades` and `candles` key `trade:1D:{symbol}`. Eight products would be at most 16 channels, under the currently documented 25-channel socket limit, although runtime coverage is BTC/ETH only.
- Bind dynamic `chanId` values from subscription acknowledgements. Trade snapshots may be newest-first; select maximum MTS. Handle `te`, `tu`, and `[chanId,"hb"]` correctly.
- Every expected trade/candle subscription must receive a unique acknowledgement. A rejection or 10-second incomplete-ACK timeout closes the socket and enters normal reconnect backoff.
- Candle control/data events must not update trade freshness. Accept a UTC open only when its MTS equals current UTC midnight and volume is positive.
- Bitfinex REST was rejected for the WebView path because its public REST responses did not provide the required Tauri-origin CORS header. CSP intentionally allows its WSS origin but not its HTTPS REST origin.

## Selection and stale behavior

For each product, `selectQuote` applies this order:

1. Coinbase WebSocket if received within 5 seconds.
2. The newest WebSocket quote from Coinbase/Kraken/Bitstamp/Bitfinex if received within 12 seconds.
3. A Coinbase REST quote if it is within the same 12-second freshness window.
4. Otherwise preserve the newest last quote and mark it stale.

REST must never temporarily outrank a healthy real-time socket. The UI status is `live` only when every selected product is fresh; otherwise it becomes `partial`, `reconnecting`, `connecting`, or `offline` according to product/source state.

Source freshness is measured with `receivedAt`. UTC-day membership is measured with exchange event time `exchangeAt`; local time zones and network delay must not choose the day. A Bitfinex trade snapshot deliberately uses its trade MTS as freshness rather than the new connection's receipt time, so an old snapshot cannot masquerade as a current tick.

## Failure handling

- Socket handshake timeout: 12 seconds.
- Coinbase/Kraken transport idle timeout: 10 seconds; BTC/ETH ticker sentinel timeout: 20 seconds.
- Bitstamp/Bitfinex idle and fixed-product ticker sentinel timeout: 30 seconds.
- Reconnect: jittered exponential delay starting near 500ms and capped at 30 seconds.
- Only fixed BTC/ETH act as shared-socket ticker sentinels. A quiet custom product becomes stale or uses REST; it must not force every product's shared socket into a reconnect loop.
- Coinbase current-price fallback checks every 5 seconds and requests only products with no fresh WebSocket quote.
- REST batches are capped at three concurrent requests per source; one product failure must not discard successful siblings.
- UTC-open requests have an 8-second abort deadline and per-product retry delay of roughly 2/4/8/16/32/60 seconds. Missing products re-enter a source-specific pending queue and retry even without another quote.
- REST UTC-open data is requested only for the source currently selected for each product. Do not prefetch every available source at startup; that creates unnecessary free-API bursts and unused cross-source state.
- UTC midnight invalidates the previous day's open immediately, including when no new ticker has arrived. Display `—` until a current-day same-source open exists.
- `setProducts` aborts old requests and uses a revision guard so removed products cannot be written back by late responses.
- When capturing browser `fetch` for `PriceFeed` or catalog work, bind it to `globalThis`. Passing an unbound WebView fetch function caused an illegal-receiver failure on Windows and is covered by a regression test.

## Adding or changing a source

Before production use:

1. Confirm with current official documentation that data is public, keyless, and a true USD market.
2. Verify the exact product/instrument catalog; do not infer pair strings.
3. Test from the target Tauri WebView origin, not only curl/Node, for CORS and TLS behavior.
4. Add only the exact HTTPS/WSS origins to CSP.
5. Define exchange timestamps, heartbeat/ACK behavior, stale thresholds, and reconnect semantics.
6. Define a same-source UTC-day open or explicitly show `—`; never borrow another exchange's open.
7. Add parser, malformed-message, source-selection, timeout/reconnect, UTC rollover, and mapping tests.
8. Recheck provider licensing before commercial redistribution.
