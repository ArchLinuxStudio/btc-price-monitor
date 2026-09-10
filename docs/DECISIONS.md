# Engineering Decisions

This document records accepted decisions that a future developer might otherwise “simplify” into a regression. Current work status belongs in [`CURRENT_STATE.md`](CURRENT_STATE.md).

## Decision: License the project under GPL v3 only

**Status:** Accepted implementation default; GPL was explicitly requested, but the exact SPDX variant was not specified

**Context:** The user requested that the About view expose a GPL license. The repository previously had no project-level license file or package metadata, and the request did not specify a GPL version or an “or any later version” grant.

**Decision:** License the project under GNU General Public License version 3 only, identified by the SPDX expression `GPL-3.0-only`. Keep the complete, unmodified GPLv3 text in the root [`LICENSE`](../LICENSE) file; the grant does not include the “or any later version” option.

**Reason:** Distribution needs a concrete license text and SPDX expression. Version 3 is the current GNU GPL text selected for this implementation, and `only` avoids silently granting use under unspecified future license versions; the project owner can explicitly broaden the grant later if desired.

**Rejected alternatives:** `GPL-3.0-or-later`, a shortened or paraphrased license file, and leaving the package metadata unspecified.

**Implications:** Keep the root license, npm and Cargo package metadata, README, and About view consistent. Distribution of binaries or modified versions must follow the GPLv3 terms, including the applicable corresponding-source and notice obligations; third-party components retain their own licenses.

## Decision: Keep Tauri 2 with a static frontend

**Status:** Accepted

**Context:** The product is a tiny cross-platform desktop overlay with native tray/window behavior.

**Decision:** Use Tauri 2/Rust plus static HTML/CSS and browser-native ES modules emitted from TypeScript. Do not add a frontend framework, bundler, or server without a concrete need.

**Reason:** System WebViews and a small Rust shell provide the required tray, always-on-top, taskbar/Dock, and packaging behavior with lower runtime/packaging overhead than Electron.

**Rejected alternatives:** An Electron rewrite (whose proposal used TypeScript) was considered before the Rust toolchain was available. Qt/PySide was also considered. Neither offered enough benefit to justify a larger runtime and a three-platform rewrite.

**Implications:** Framework migration requires explicit user approval plus evidence on size, memory, signing, release maintenance, and platform behavior.

## Decision: Use strict TypeScript as a source-language-only migration

**Status:** Accepted; explicit user request

**Context:** The user requested converting the existing JavaScript frontend to TypeScript while leaving features, UI, and Rust unchanged.

**Decision:** Author frontend modules and Node tests in strict TypeScript. Use `tsc` only to erase types and emit native ES modules into ignored `dist/`; copy or inject local HTML, CSS, icon, and license assets through `scripts/frontend.ts`. Use `tsx` only to execute TypeScript tests and build tooling.

**Reason:** This adds compile-time contracts at storage/network/DOM/IPC boundaries without introducing a framework, bundling, a development origin, or a different browser module graph.

**Rejected alternatives:** Vite or another bundler for this migration, framework adoption, direct WebView execution of TypeScript, and changes to the Rust shell.

**Implications:** Source imports used by the browser retain `.js` specifiers so emitted modules resolve natively. Tauri serves/packages `dist/`, `npm run check` must typecheck and emit before delivery, and generated output must not be committed.

## Decision: Preserve the compact 208px design

**Status:** Accepted; amended by explicit user request on 2026-08-31

**Context:** Earlier `372×188` and `264×92` designs were rejected as too large/wide. The user repeatedly asked for a compact, modern, premium-looking monitor without extreme-price whitespace.

**Decision:** Width stays `208px`; default BTC/ETH view is `208×92`. Automatic quote height caps at four visible rows, while five or more selected products expose a bottom handle that can increase quote height up to the lesser of selected content and the current monitor's remaining work-area height. There is no eight-row manual-height ceiling; longer watchlists remain available through internal scrolling. Management still replaces the quote region temporarily and remains capped at `170px`.

**Reason:** The accepted practical display range is BTC in the hundreds of thousands and ETH in the tens of thousands; verified current boundaries include `$999,999.99`, `$99,999.99`, and `−99.99%` without collision.

**Rejected alternatives:** Restoring the large card/footer design, changing width, automatic expansion beyond four rows, allowing manual expansion beyond the current screen work area, reserving width for unrealistic extremes, or placing permanent delete controls in every quote row.

**Implications:** Internal scrolling remains whenever content actually overflows. Layout changes require a real rendered image when presenting a prototype and a final native Tauri-window smoke test, including drag growth/shrink, fixed width, and the management cap. Do not rely only on a browser viewport.

## Decision: Separate real-USD crypto spot from labeled stock-related USDT perpetuals

**Status:** Accepted; amended by explicit user request on 2026-08-29

**Context:** The user originally required true USD and a UTC+0 daily basis. The user later explicitly allowed USDT-settled perpetual contracts for stock-related products, while clarifying that the integration must cover dynamic exchange catalogs rather than hard-code MU.

**Decision:** Crypto spot remains true USD only. Stock-related USDT perpetuals are a separate product class, identified visibly as `.P` and `USDT永续`; they must not be described as direct shares. Compute change from the displayed exchange product's own current UTC-day open in both classes.

**Reason:** Explicit product labeling accepts the requested derivative without pretending USDT is fiat USD. Rolling 24-hour values and cross-exchange price/open combinations still answer a different question or introduce artificial change.

**Rejected alternatives:** Silent USDT/USDC substitution for crypto spot, calling a perpetual a stock holding, hard-coding MU, provider 24-hour percentage fields, local-time midnight, guessed aliases, and cross-exchange mixing.

**Implications:** If the selected source has no current-day open, show `—`. Search/persistence/UI must preserve product class and quote currency. Any change to this semantic must update market-data tests first.

## Decision: Product-specific hot sources with exact mappings

**Status:** Accepted

**Context:** Reliability requires independent live providers, but custom symbols differ between exchanges and can contain aliases or colon formats.

**Decision:** Keep Coinbase, Kraken, Bitstamp, and Bitfinex sockets hot for supported USD spot products. For stock-related perpetuals, use the independently discovered Bybit and Gate catalogs, keep exact supported sockets hot, and use source-specific REST fallback. Prefer recent Coinbase for USD spot or recent Bybit where mapped, then the newest healthy WebSocket, then a supported source-specific REST quote. Subscribe/query only when an exact official mapping exists.

**Reason:** Hot sockets fail over without a post-failure handshake. Exact catalogs/mappings prevent bad subscriptions such as assumed `${symbol}/USD` pairs.

**Rejected alternatives:** Cross-exchange averaging, guessed symbols, REST-only polling, and letting a recent REST response outrank healthy WebSockets.

**Implications:** Coinbase covers every selectable USD spot product. Bybit and Gate each contribute stock-related perpetuals; an exact canonical-ticker match combines their coverage without equating aliases. Bitstamp can enrich exact USD-spot catalog intersections; Kraken/Bitfinex custom coverage remains disabled until an official browser-safe exact directory exists.

## Decision: Do not add weak sources merely to increase the count

**Status:** Revisit later only after fresh research

**Context:** Candidate-source behavior and policies can change; the following conclusions are a 2026-08 research snapshot, not permanent external facts.

**Decision:** The following were not added:

- Binance: its mainstream high-frequency crypto pairs are USDT, so it was not suitable as a silent replacement for true-USD crypto spot. This older conclusion does not prohibit explicitly labeled stock-related USDT perpetuals; Bybit/Gate were selected for the current implementation because their live public directories and browser paths were verified for this product class.
- Crypto.com: the API's “USD” represented a renamed stablecoin bundle rather than strict fiat USD.
- Gemini: a new public multi-product WebSocket was promising, but documented versus live candle timeframe values (`1d`/`1day`) differed.
- Coin Metrics Community: aggregated reference methodology could include stablecoin conversion and its free license was not a clean general redistribution fit.
- CoinGecko/CoinPaprika: slower free refresh and licensing/rate-limit tradeoffs.
- CoinCap/Pyth: key requirements conflicted with the user-keyless constraint.
- DIA: roughly minute/120-second refresh was too slow for a real-time monitor.

**Reason:** Reliability is not improved by a semantically weaker, slow, licensed, or soon-to-be-keyed source presented as equivalent.

**Implications:** Reconsider only with current official documentation, live Tauri-origin tests, and explicit user acceptance of any proxy/aggregation/key/license/latency tradeoff.

## Decision: Keep browser networking behind exact CORS and CSP boundaries

**Status:** Accepted

**Context:** A public endpoint reachable by curl is not necessarily callable from a WebView.

**Decision:** Browser-fetch only the Coinbase, Kraken, Bitstamp, Bybit, and Gate REST endpoints currently allowed by exact CSP origins. Keep Bitfinex entirely on public WSS for current runtime needs. Allow only the exact six market-data WSS origins used by configured providers.

**Reason:** Bitfinex public REST lacked the required Tauri-origin CORS response. Adding a wildcard CSP would not fix CORS and would weaken security.

**Rejected alternatives:** Opening arbitrary HTTPS origins, assuming “public” means CORS-enabled, or adding a Rust HTTP dependency without a demonstrated platform problem.

**Implications:** If CORS/TLS differs on a target platform, prefer a narrowly allowlisted Rust command and tests rather than broad CSP.

## Decision: Closing hides; tray Quit exits

**Status:** Accepted; explicit user requirement

**Context:** The monitor must not occupy taskbar/Dock space and should remain available from the notification area.

**Decision:** Start with the floating window visible, keep a tray icon, hide on close/Alt+F4, and exit only from the tray Quit command.

**Reason:** This matches the expected resident-monitor model while preserving an explicit process-exit path.

**Rejected alternatives:** Normal taskbar/Dock presence, default silent startup with no visible monitor, or treating the close button as process termination.

**Implications:** Do not promise that hidden WebViews process every tick on every OS; promise that the process stays resident and reconnects/continues when restored.

## Decision: Use a compact local About window with a scoped repository opener

**Status:** Accepted; updated by explicit user request on 2026-08-30

**Context:** The original About design displayed the complete repository address and an expandable copy of the full GPL text without any script or native capability. The user subsequently requested a more compact layout, removal of the full GPL text, and a GitHub icon that opens the repository.

**Decision:** Pre-create one hidden, fixed `320×280px` `about` WebView from local assets, show/center/focus it from a normal tray item, and hide/reuse it on close. Inject only the application version from `tauri.conf.json`; show the canonical icon, a concise `GPL-3.0-only` notice, and one accessible GitHub icon button. The button uses Tauri's opener plugin through a separate `about` capability scoped to the exact canonical repository URL. Continue copying `assets/app-icon.svg` and the complete `LICENSE.txt`, and keep the root `LICENSE` configured as the bundle license file.

**Reason:** The revised layout matches the user's explicit request while preserving deterministic local presentation and complete license delivery in the source and packaged artifacts. A dedicated exact-URL permission opens the repository in the system browser without granting general navigation, changing CSP origins, or exposing the main monitor's commands.

**Rejected alternatives:** The superseded full-address/full-license overlay, platform-native `PredefinedMenuItem::about`, hard-coding a second version string, duplicating the icon source, ordinary WebView navigation, `opener:default`, wildcard URL scope, or granting About the main monitor capability.

**Implications:** Keep `src/about.html`, `src/about.ts`, `scripts/frontend.ts`, the exact repository URL capability, Tauri version/bundle metadata, `LICENSE`, and the canonical icon synchronized. The full license remains in the root source, frontend distribution, and applicable installers rather than the About viewport. The About window must not change the main monitor's fixed `208px` width contract, CSP origins, taskbar/Dock policy, or tray-only exit contract.

## Decision: Do not cap the watchlist; screen-bound manual quote height

**Status:** Accepted; amended by explicit user request on 2026-08-31

**Context:** The original implementation fixed BTC/ETH and limited the user to six custom products. The user explicitly removed that product-count limit and accepted arbitrarily long lists without deriving a selection cap from screen boundaries.

**Decision:** Keep BTC/ETH fixed but impose no application-level count limit on additional valid supported products. Persistence validates and deduplicates every entry without truncating the list; search add actions never become disabled because of selected count. Keep at most four rows in the automatic quote viewport, but let the dragged quote viewport grow past eight rows until it reaches either all selected content or the current monitor work-area bottom. Additional quote and management rows remain available through internal scrolling. Frontend IPC sends the complete quote row count while Rust owns the content/work-area clamp.

**Reason:** Selection capacity and screen-filling manual height are direct user requirements and must not be coupled to the former eight-row geometry. Validation, free REST concurrency control, and exact provider-symbol rules still protect data quality and load; native content/work-area sizing keeps the IPC permission narrow without discarding selected products or extending the window past the usable screen.

**Rejected alternatives:** Any fixed selected-item cap, silently truncating persisted products, disabling search results because the list is “full,” retaining the eight-row/`290px` manual ceiling, unbounded automatic desktop expansion, general OS resizing, and exposing arbitrary frontend width/height control or set-size permissions.

**Implications:** No `MAX_PRODUCTS`-style application constant, persistence truncation, eight-row frontend saturation, or static main-window `maxHeight` may return. Keep the `26 + 33 × rows` content budget, the `158px` automatic maximum, the `170px` management cap, overflow accessibility, complete quote-row sizing IPC, Rust content/work-area clamps, Tauri width limits, and README behavior synchronized. The dragged preference is session-only and is clamped again after product changes or monitor/work-area changes.

## Decision: Every quote row is reorderable without reconnecting market feeds

**Status:** Accepted; explicit user requirement on 2026-08-31

**Context:** The user requested drag ordering directly in the main quote view. The prior persistence normalizer always restored BTC/ETH to the first two positions, and `PriceFeed.setProducts` treats array-order changes as subscription changes that would unnecessarily restart every socket.

**Decision:** Treat `fixed` as non-removable rather than position-locked: BTC, ETH, and every custom quote row may be reordered. Use delegated HTML5 drag/drop with before/after insertion indicators, edge auto-scroll, unified cancellation cleanup, and `Alt+ArrowUp/Down` as the keyboard equivalent. Persist only after a successful order change and rebuild the quote DOM while retaining scroll/focus; do not call `PriceFeed.setProducts` for a display-only reorder. Preserve explicit fixed-item positions when both defaults are present, while incomplete/damaged persisted arrays recover canonical BTC/ETH before custom items.

**Reason:** Direct row dragging matches the requested surface, the pure reorder helper makes index correction and persistence testable, and keeping the existing feed connections alive avoids visible data interruption for a presentation-only change. Keyboard ordering and live position announcements preserve access without taking ordinary Arrow keys away from scrolling.

**Rejected alternatives:** Keeping BTC/ETH permanently first, limiting ordering to the management view, restarting market sockets after every move, exposing a native/general resize or drag permission, and whole-row custom Pointer Events that conflict with vertical scrolling. A dedicated touch drag handle may be reconsidered only if touch support is requested.

**Implications:** Main-window `dragDropEnabled` is false because Tauri's native file-drop integration intercepts frontend HTML5 drag events on Windows; page-level external-drop guards are therefore required. Keep row `draggable`/list semantics, drop indicators, keyboard shortcuts, focus/live announcements, pure fixed/custom reorder tests, stored-order round trips, title-bar dragging, bottom height resizing, and the absence of a reorder-time `feed.setProducts` call synchronized.

## Decision: Use one exact-source, work-area-maximized candlestick window

**Status:** Accepted; explicit user requirements on 2026-09-01 and 2026-09-02

**Context:** The user requested a first basic candlestick viewer opened from a main quote row, with selectable candle length, while the compact main interface stays visible. A native/exclusive fullscreen window would conflict with that coexistence requirement on some platforms, and borrowing history from a different exchange would violate the existing same-source market-data contract.

**Decision:** Pre-create one hidden, undecorated `chart` WebView and reuse it. A row click or `Enter`/`Space` activation snapshots the validated product plus that row's current `DisplayQuote.marketSource`; Rust stores a byte-bounded opaque JSON selection, shows the chart on the main window's monitor, and maximizes it to the normal work area while leaving `fullscreen: false` and `alwaysOnTop: false`. The main `208px` monitor is never hidden and retains its existing always-on-top behavior. The static local chart uses a DPI-aware `<canvas>`, no framework/CDN/runtime dependency, and five intervals: `1m`, `5m`, `15m`, `1h`, and `1d`. It requests history only from Coinbase for real-USD spot or from the exact Bybit/Gate stock-related USDT-perpetual mapping. Wheel/trackpad and visible `＋/−` controls zoom around an anchor down to 12 candles; primary-pointer drag and focused-canvas keys pan. Default/reset range and bounded older-history loading follow the subsequent zoom decision. If the active quote source is Kraken, Bitstamp, Bitfinex, or unavailable, show an explicit unsupported/unavailable state rather than substituting another source or fabricating gaps. Closing, `Escape`, and Alt+F4 hide/reuse the chart and restore/focus the main monitor.

**Reason:** A normal maximized window provides the requested chart-sized surface without moving macOS into a separate fullscreen Space or covering the always-on-top monitor. Freezing the displayed quote's exchange preserves semantic honesty: the chart, source badge, product class, and price row all describe the same market. A local canvas keeps the existing small static architecture and exact CSP.

**Rejected alternatives:** Hiding/replacing the main monitor; native/exclusive fullscreen; opening one chart per row; dynamically creating frontend windows; embedding a remote chart or adding a charting framework/CDN/bundler; giving the frontend arbitrary create/resize/maximize/fullscreen permissions; unbounded/infinite-scroll history fetches during pan; defaulting unsupported sources to Coinbase; mixing spot and perpetual history; synthesizing missing candles; or reconnecting `PriceFeed` merely to open a display-only view.

**Implications:** `main` receives only the fixed `show_chart_window` command in addition to its existing capability. `chart` receives only selection retrieval, chart close, and fixed-event listen/unlisten; Rust alone owns placement/maximization. The versioned selection is validated on both frontend boundaries, remote text remains text-only, external drops are prevented, interval changes abort obsolete requests, and sparse valid provider history remains sparse. Viewport math stays pure/tested and in candle units, while the renderer clips partially visible candles and derives price/time axes plus non-live accessible summaries from the current visible range. Product/interval reload and window hiding cancel drag and reset the viewport. Keep `chart.*`, `chart-viewport.ts`, `chart-navigation.ts`, `candle-history.ts`, `chart-selection.ts`, the three window configurations/capabilities, provider documentation, and their focused TypeScript/Rust/static tests synchronized. No CSP origin was added because the three HTTPS origins were already allowlisted for existing market work.

## Decision: Zoom into detail and out into bounded older history

**Status:** Accepted; explicit zoom correction requested on 2026-09-07 and resumed on 2026-09-08

**Context:** The initial chart decision capped total history at 240 candles and opened/reset to the entire loaded series. That made initial zoom-out unavailable and prevented users from revealing older candles. A fixed 12px body-width cap also made zoom-in widen gaps after candle bodies stopped growing. The user explicitly requested initial zoom-out, more historical candles when zooming out, and larger candle detail when zooming in, with TradingView as an interaction reference. This request supersedes the earlier total-240 and full-series-reset restrictions.

**Decision:** Open/reset to up to the newest 120 available candles, retaining the 12-candle zoom-in minimum. Derive horizontal spacing from plot width divided by visible candle count and body width from 72% of that spacing, without the old fixed pixel cap. Wheel zoom retains its pointer anchor; button/keyboard zoom keeps the newest edge when current and otherwise the viewed range center. Allow requested zoom/pan ranges to extend before loaded data and fetch older history from the same frozen product/source/interval. Each page returns at most 240 candles, each demand-driven batch performs at most four serial page requests, and each selection/interval caches at most 4,800 candles. Under the subsequent origin correction, Coinbase/Gate scan bounded 240-bucket windows with range-start cursors; Bybit uses end-only queries across gaps and the oldest returned candle as its exclusive cursor. Sparse or empty bounded windows alone do not establish origin; a valid Bybit end-only empty result can. Provider details are authoritative in `MARKET_DATA.md`. Pending batches and failures retain the chart with a continue/retry action.

**Reason:** The visible time range must grow when zooming out. Smaller bar spacing fits more data into the same canvas, consistent with the [TradingView time-scale documentation](https://www.tradingview.com/charting-library-docs/latest/ui_elements/Time-Scale/). Bounded same-source pagination satisfies that behavior while keeping memory, rendering, and public API request work finite; the existing static canvas architecture remains sufficient.

**Rejected alternatives:** Restoring initial full-series zoom limits; expanding gaps while candle bodies stop growing; silently changing interval or exchange to simulate more history; treating one empty bounded window as complete history without provider proof; background prefetch of all available history; unbounded automatic page loops; or adding TradingView as a runtime dependency.

**Implications:** `chart-navigation.ts` owns loaded data and pending viewport intent separately. Prepending candles shifts the viewport and active drag origin together. Reversing to zoom-in uses the visible range immediately, even if older pages are pending. Reset, double-click, and `0` return to the newest 120 candles; `End` returns to the newest edge at the visible scale. Late pages may enter the cache but cannot restore superseded navigation intent. Product/interval changes and window hiding cancel and invalidate obsolete work. Keep navigation, page boundaries, sparse history, retry, geometry, and race-condition regressions synchronized. This change does not alter the native window contract, product/source policy, CSP, capabilities, or `PriceFeed` behavior.

## Decision: Allow bounded zoom-out space after all history fits

**Status:** Accepted; explicit user refinement on 2026-09-10

**Context:** The previous count clamp and minus-button condition stopped zoom-out when all retained candles filled the plot. The user requested further compression and blank space after reaching that view.

**Decision:** Separate viewport slots from actual cached candles. Once older loading is unavailable (confirmed completion, cache cap or a query boundary), allow up to `2 × retained candle count` slots, so the full series can occupy half the plot. This local, bounded reserve applies even to one-candle or sparse history. Preserve the latest-120 reset, `min(12, total)` zoom-in floor, proportional 72% bodies, pointer/latest/center anchors, and one-complete-candle pan edges. The controls and navigation use the same visual limit.

**Loading:** While older history remains queryable, keep progressive pending zoom and the existing four-page batch/prefetch/cooldown behavior. An empty or partial page that confirms completion or reaches the query boundary, or the cache filling via older/live candles, resolves the pending range up to the new visual limit around its original anchor. An ordinary empty bounded window does not terminate pending history. Reverse zoom, pan and reset still supersede pending intent. The reserve neither stores synthetic candles nor raises the 4,800-real-candle cap, and it never establishes history origin by itself.

**Reference:** TradingView's [horizontal-scale options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HorzScaleOptions) separate bar spacing and scrollable edges. The factor of two is this application's bounded interpretation of the requested extra space, not a claim about TradingView's exact default zoom limit. No runtime chart dependency is introduced.

## Decision: Crosshair inspection and a paced history buffer

**Status:** Accepted; explicit user request on 2026-09-08 after accepting the basic zoom behavior

**Decision:** Use a crosshair cursor during hover and drag, a vertical dashed guide snapped to a visible real candle center, and a horizontal dashed guide at the pointer's price. Show the candle's actual UTC timestamp on the time axis and the pointer price on the price axis. Keep projection pure and share the renderer's viewport and padded price range. Draw guides on a separate transparent canvas, coalesced by animation frame, so ordinary pointer motion does not repaint candles. Axis markers are chart annotations, not HTML `title` tooltips; leave/hide/reload/cancel clears them.

After installing the current navigation instance, enable a 480-candle buffer before the visible left edge. A normal first page of 240 candles with the latest 120 visible therefore warms to 720 cached candles. Fetch each speculative page after a one-second delay, with no overlapping history requests. Explicit older-range demand reuses the same flight and has priority; adding data shifts candle indices and any drag origin together without changing the visible time/scale. Preserve the four-page demand batch and 4,800-candle cache cap. Stop speculative scanning after an empty/nonadvancing page, an error, or four insufficient sparse pages; a successful explicit demand page may resume it. HTTP 429/403 pause older requests in the current navigation instance for 60 seconds/10 minutes, respectively, without automatic retries. Product/interval reload and hiding cancel its timers and requests.

**Reason:** Inspection needs precise time/price guides, and a small advance buffer removes network waits from ordinary zoom/pan. The user's new request authorizes bounded preloading; it does not overturn the rejection of fetching all available history in the background. Conservative pacing leaves headroom for the existing free market feeds.

**Implications:** Keep `chart-crosshair.ts`, the overlay/UI, navigation scheduling tests, provider rate-limit references in `MARKET_DATA.md`, and lifecycle checks synchronized. Prefetch applies only to the selected product/source/interval; do not fan out across the watchlist or intervals. The cooldown is local to a navigation instance, not a global IP budget or a promise that another application cannot cause provider limits. No dependency, framework, CSP, capability, native command, or public market-feed contract changes.

## Decision: Allow blank pan margins and mark the loaded history start

**Status:** Accepted; explicit user clarification and implementation request on 2026-09-08

**Decision:** Allow horizontal panning beyond either data edge until one complete end-candle slot remains: for viewport capacity `count` and loaded series length `total`, clamp its start to `[1 - count, total - 1]`. Retain count and proportional bar spacing while dragging; the first candle can reach the right and the latest can reach the left without losing all data offscreen. `Home` still opens the earliest loaded range at start zero; `End` restores the usual latest range, and reset still shows the latest 120. Keep larger pending zoom intent separate from the renderable pan viewport, preserving its anchor as pages arrive and letting drag/reset/reverse zoom replace obsolete intent.

The initial implementation placed “已加载起点” at every visible cache-first candle. **This marker meaning was rejected by the user on 2026-09-09 and is superseded by the confirmed-origin decision below.** The two-sided pan, real-date collision layout, and blank crosshair behavior remain accepted.

**Reason:** The user explicitly requested room on both sides while inspecting chart history. This matches the separation of bar spacing, offsets, and freely scrollable edges in [TradingView's horizontal-scale options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HorzScaleOptions). The local canvas and exact-source/capped history contract remain sufficient; no external chart library is needed.

**Implications:** Preserve bounded same-source pagination and prefetch. After a failed/nonadvancing demand page or an unfinished four-page batch, continuing pointer movements must not restart requests automatically. Explicit “继续加载” can retry subject to the existing provider cooldown; returning to a loaded range or resetting permits a later new demand. Tests cover both one-candle edges, sparse/no-more-history/cache-limit states, pending zoom and prepend anchors, held-pointer retry suppression, and time-axis/crosshair behavior in blank space. This supersedes the earlier pan constraint that the full viewport had to remain within loaded candles; it does not change native permissions or market semantics.

## Decision: Confirm the actual history origin before marking it

**Status:** Accepted; explicit correction requested on 2026-09-09

**Decision:** Show “历史起点” only when the current source's earliest queryable candle has been established and retained. A loaded page edge, a short/empty bounded window, an error, or the 4,800-candle cap does not prove origin. `CandleHistoryPage.historyComplete` conveys provider-level completion; navigation separately checks whether cache truncation discarded the earliest candle. Confirmed completion stops both demand and prefetch and removes “继续加载”. Unknown completion uses “尚未确认历史起点，可继续查询”. Preserve two-sided blank pan at all boundaries.

For Coinbase, lazily verify exact-product trade ID 1 with `after=2&limit=1` and verify `after=1&limit=1` is empty; use that time's interval bucket as a conservative scan lower bound. For Gate, use the exact contract's validated `create_time` bucket. Metadata never creates candles or overrides earlier observed data. For Bybit, query `end` without `start`, keep the actual oldest returned timestamp as the exclusive cursor, and declare completion only on a valid empty list covering all earlier times. These routes are supported by [Coinbase trade pagination](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-trades), [Coinbase cursor direction](https://docs.cdp.coinbase.com/exchange/rest-api/pagination), [Bybit Kline parameters](https://bybit-exchange.github.io/docs/v5/market/kline), and [Gate contract metadata](https://www.gate.com/docs/developers/apiv4/en/#get-a-single-contract). The lower-bound interpretation is local engineering logic checked against actual provider responses, not an additional provider guarantee of complete archived data.

**Constraints:** Origin metadata is requested serially only after the first short/empty Coinbase/Gate page, cached within the frozen selection/interval, and failed probes remain unknown without automatic retries. Metadata 429/403 preserve the received candles and impose the existing 60-second/10-minute cooldown once. The actual chart loader rejects partially malformed candle pages so discarded rows cannot later masquerade as the first candle; the older array-returning helper retains its compatibility behavior. No provider, symbol guess, key, CSP origin, or native permission is added.

**Rejected alternatives:** A flag at each cache edge; treating any empty window or cache cap as listing inception; unlimited empty-window scanning as the only end detector; Coinbase `before=0` (observed to return latest trades); Bybit `launchTime` as the cutoff (could exclude prelisting data); or inventing OHLC data from metadata. If origin evidence is unavailable, keep it unconfirmed rather than declaring success.

**Presentation:** Date and price axes use brighter 12px semibold values, matching measured crosshair fonts and expanded margins. Preserve compact-window label bounds and real UTC dates.

## Decision: Show a live same-source current-price guide

**Status:** Accepted; explicit user request on 2026-09-09

**Decision:** Display a 1px dashed horizontal current-price line and a matching colored right-axis label. Its value follows the synchronized last-candle close under the subsequent synchronization decision, with green/red relative to that candle's open. An unavailable quote creates no line; a retained stale quote uses gray and “报价滞后”. Keep crosshair inspection labels above the current-price layer. The [TradingView series options](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/SeriesOptionsCommon) provide the thin dashed line and axis-value style reference; no chart library is added.

One visible chart subscribes only to its frozen exact Coinbase/Bybit/Gate product through the existing resilient WebSocket code. Reuse same-source REST parsers for cold-start/failure fallback, with healthy WebSocket priority, the existing 12-second freshness rule, serial requests at least five seconds apart, an eight-second timeout and 429/403 cooldowns. Interval changes retain the quote connection; product/source changes and hiding stop and invalidate old work. Do not instantiate a second full `PriceFeed`, fan out across sources, reconnect the monitor feed, or fetch daily opens just to draw this guide.

**Original boundary, superseded by the synchronization correction below:** The first guide updated only its price overlay and left OHLC at the initial history snapshot. User testing found that this separates the line from the newest candle close. The prior tests verified line-to-axis alignment but missed line-to-candle equality. Exact-source selection, CSP, permissions and package versions remain unchanged.

## Decision: Synchronize the current candle and its price guide

**Status:** Accepted; explicit user correction on 2026-09-09

**Decision:** The guide's value always comes from the last loaded candle's close. A fresh same-source/product quote may update close/high/low only in the already established matching time bucket, preserving its exchange-provided open. Candle geometry and guide render in the same animation frame. Reject stale quotes and event times older than the accepted snapshot or live watermark. Pointer-only crosshair movement still redraws just its overlay.

Refresh actual recent OHLC from the existing source/interval on interval rollover, stale recovery and a 30-second reconciliation cadence. Requests remain serial, at least five seconds apart, with an eight-second timeout and HTTP 429/403 cooldowns of 60 seconds/10 minutes. Retain and replay bounded same-bucket quote extrema/last values from during the request so a late snapshot cannot overwrite a newer quote. This is bounded history reconciliation, not REST replacing the primary WebSocket quote stream. Coinbase's public [WebSocket candle channel](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-endpoints) supplies five-minute buckets, so it cannot alone cover the requested 1m interval; the existing REST intervals remain authoritative for opens and new buckets.

**Missing buckets:** Never create a candle from a ticker snapshot, repeat the previous close across a gap, or apply a new-minute quote to the preceding minute. Until the exchange supplies the new candle, keep the guide attached to the last actual close and show “同步 K 线…”. Failures retain the chart; stale quotes remain explicitly marked. Known existing buckets can be reconciled and actual later buckets appended, without changing the older-history cursor or confirmed origin. Latest-aligned views follow appended bars; historical views, active drags and blank margins preserve their time anchors. The 4,800-candle cap also applies to live appends; evicting the original first candle removes its origin flag.

**Lifecycle and validation:** Interval changes replace the candle synchronizer while keeping the same quote connection. Source/product changes, hide/close and failed initialization cancel both obsolete work and late callbacks. Test direct line-to-last-body/close equality, 1m rollover, request-time extrema replay, sparse gaps, stale/recovery, interval races, signed cache-trim offsets and concurrent older loads. No new provider, symbol, dependency or native permission is introduced.

## Decision: No hover text tooltips

**Status:** Accepted; explicit user requirement

**Context:** The user considered hover information redundant.

**Decision:** Do not use HTML `title`, dynamic `.title`, or a tray tooltip. Retain accessible names through `aria-label` and allow purely visual hover styling.

**Reason:** This removes unwanted popups without removing keyboard/screen-reader context.

**Rejected alternatives:** Restoring tooltips only for truncated text or source/status details.

**Implications:** `tests/ui.test.ts` guards this behavior.

## Decision: Use the fixed ES2025 baseline and require macOS 12

**Status:** Accepted; explicit user requirement

**Context:** The former bundle floor was macOS 10.15 with an `ES2019` TypeScript target. The user explicitly ended 10.15 support and requested the newest project language baseline. The pinned TypeScript 6.0.3 toolchain exposes `ES2025` as its newest concrete target and also exposes the floating `ESNext` alias.

**Decision:** Set the shared TypeScript `target` and ECMAScript library to `ES2025`, keep the existing browser-native `module: ES2022` contract, and set Tauri `bundle.macOS.minimumSystemVersion` to `12.0`. Use the newest fixed standard implemented by the pinned compiler rather than the upgrade-dependent `ESNext` alias. Do not add a transpiler, bundler, or blanket polyfill layer as part of this baseline change.

**Reason:** A named standard gives the requested modern output while keeping dependency upgrades reproducible. Tauri propagates the minimum-system setting to the bundle metadata and macOS deployment target, so a duplicate CI environment override is unnecessary.

**Rejected alternatives:** Retaining `ES2019`/macOS 10.15, using floating `ESNext`, changing the independent module output without a module-format need, or introducing a framework/bundler merely to change the compiler target.

**Implications:** The shared application, test, and build configs inherit `ES2025`; a static regression locks it together with the macOS 12.0 floor. TypeScript target/lib settings do not polyfill APIs or guarantee that the system WKWebView shipped with every macOS 12 point release implements all ES2025-era features. Review new syntax and runtime APIs individually, retain fallbacks where needed, and perform minimum-version macOS runtime/package verification before release. A future compiler upgrade must not silently move this fixed target.

## Decision: Releases require a new version and five assets

**Status:** Accepted; explicit user requirement

**Context:** Earlier releases accidentally contained only Windows assets, and Chinese release text once became question marks.

**Decision:** A source push is not a release. Formal releases use a new SemVer tag, four build runners, five desktop assets, correct UTF-8 text, and post-upload verification.

**Reason:** The product promises Windows, macOS Intel/Apple Silicon, AppImage, and deb availability.

**Rejected alternatives:** Uploading only the local Windows installer, moving an old tag, or manually dispatching and assuming artifacts became Release assets.

**Implications:** Follow [`RELEASE.md`](RELEASE.md). Never overwrite or move a published tag or Release. The local unreleased chart build still reports `1.6.2` while published `v1.6.2` predates it, so any formal release of this work requires a new version and tag.
