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

**Status:** Accepted; explicit user preference

**Context:** Earlier `372×188` and `264×92` designs were rejected as too large/wide. The user repeatedly asked for a compact, modern, premium-looking monitor without extreme-price whitespace.

**Decision:** Width stays `208px`; default BTC/ETH view is `208×92`. Normal rows cap at four visible entries and management replaces the quote region temporarily.

**Reason:** The accepted practical display range is BTC in the hundreds of thousands and ETH in the tens of thousands; verified current boundaries include `$999,999.99`, `$99,999.99`, and `−99.99%` without collision.

**Rejected alternatives:** Restoring the large card/footer design, reserving width for unrealistic extremes, or placing permanent delete controls in every quote row.

**Implications:** Layout changes require a real rendered image when presenting a prototype and a final native Tauri-window smoke test. Do not rely only on a browser viewport.

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

## Decision: Use a local static About window

**Status:** Accepted; explicit user request

**Context:** The tray menu must expose an About view containing the current application version, application icon, GitHub repository address, and GPL license information consistently on Windows, macOS, and Linux.

**Decision:** Pre-create one hidden, fixed-size `about` WebView from local `about.html`, show/center/focus it from a normal tray menu item, and hide/reuse it on close. Inject the application version from `tauri.conf.json` and an HTML-escaped copy of the complete root `LICENSE` during the frontend build, copy the canonical `assets/app-icon.svg` and `LICENSE.txt` into the frontend distribution, configure the root license as Tauri's bundle license file, and leave the About window outside every IPC capability.

**Reason:** Tauri's platform-native predefined About item cannot display the full requested metadata consistently across all three operating systems. A local static page is deterministic, keeps the current CSP, and needs no new plugin, network origin, or frontend-native permission.

**Rejected alternatives:** Platform-native `PredefinedMenuItem::about`, hard-coding a second version string, duplicating the icon source, granting the About page the main monitor's IPC commands, and adding an external-URL opener when the requested repository address only needs to be displayed and selectable.

**Implications:** Keep `src/about.html`, `scripts/frontend.ts`, Tauri version/bundle metadata, `LICENSE`, and the canonical icon synchronized. Recipients must be able to read the complete license without access to the source checkout. The About window must not change the main monitor's `208px` envelope, taskbar/Dock policy, or tray-only exit contract.

## Decision: Cap the watchlist at eight and compute size natively

**Status:** Accepted

**Context:** Watchlist size affects compactness, channel counts, and failure-time REST load.

**Decision:** Fix BTC/ETH, allow six custom products, display four rows/items before internal scroll, and let Rust compute height from counts.

**Reason:** One bound simultaneously protects UI density, provider subscription scale, and free API usage. Native calculation keeps the IPC permission narrow.

**Rejected alternatives:** Unlimited items, expanding the desktop window indefinitely, and exposing arbitrary frontend width/height control.

**Implications:** Keep `MAX_PRODUCTS`, CSS row budgets, Rust height tests, Tauri width limits, and README behavior synchronized.

## Decision: No hover text tooltips

**Status:** Accepted; explicit user requirement

**Context:** The user considered hover information redundant.

**Decision:** Do not use HTML `title`, dynamic `.title`, or a tray tooltip. Retain accessible names through `aria-label` and allow purely visual hover styling.

**Reason:** This removes unwanted popups without removing keyboard/screen-reader context.

**Rejected alternatives:** Restoring tooltips only for truncated text or source/status details.

**Implications:** `tests/ui.test.ts` guards this behavior.

## Decision: Maintain macOS 10.15 compatibility

**Status:** Accepted

**Context:** The macOS bundle declares 10.15 minimum and ships browser-native JavaScript to WKWebView.

**Decision:** Emit an ES2019 syntax target and avoid runtime APIs unsupported by that WebView, or make a deliberate target/minimum-version change.

**Reason:** A new browser API can pass on Windows WebView2 while failing on the supported macOS floor.

**Rejected alternatives:** Quietly raising the minimum or assuming all system WebViews match current Chromium.

**Implications:** Preserve compatibility choices such as `Object.prototype.hasOwnProperty.call` and test on real macOS before release when relevant.

## Decision: Releases require a new version and five assets

**Status:** Accepted; explicit user requirement

**Context:** Earlier releases accidentally contained only Windows assets, and Chinese release text once became question marks.

**Decision:** A source push is not a release. Formal releases use a new SemVer tag, four build runners, five desktop assets, correct UTF-8 text, and post-upload verification.

**Reason:** The product promises Windows, macOS Intel/Apple Silicon, AppImage, and deb availability.

**Rejected alternatives:** Uploading only the local Windows installer, moving an old tag, or manually dispatching and assuming artifacts became Release assets.

**Implications:** Follow [`RELEASE.md`](RELEASE.md). Never overwrite the published `v1.2.1` with a local development build that still reports version 1.2.1.
