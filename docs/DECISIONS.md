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

**Decision:** Author the four frontend modules and Node tests in strict TypeScript. Use `tsc` only to erase types and emit native ES modules into ignored `dist/`; copy `index.html` and `styles.css` unchanged. Use `tsx` only to execute TypeScript tests and build tooling.

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

**Implications:** Follow [`RELEASE.md`](RELEASE.md). Never overwrite the published `v1.2.1` with a local development build that still reports version 1.2.1.
