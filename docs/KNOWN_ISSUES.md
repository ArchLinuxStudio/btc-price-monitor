# Known Issues and Limitations

One chart-selection defect is confirmed below; there is no known flaky test at this checkpoint. This document records real limitations and technical debt; actionable work is linked to [`TODO.md`](TODO.md).

## No normal main/PR CI and incomplete CI checks

**Symptom:** The desktop workflow triggers only for manual dispatch or `v*` tags. It now runs the complete TypeScript/frontend `npm run check`, but it still does not run Rust fmt/test/check/clippy.

**Impact:** A pushed main commit can have no GitHub status even when local verification was performed; Rust quality regressions may be discovered only at release time.

**Current evidence:** See the dated verification snapshot in [`CURRENT_STATE.md`](CURRENT_STATE.md); query GitHub again for a future commit.

**Runner warning:** The successful `v1.7.0` run `34436389439` reports that the Node 20 action runtimes in `actions/checkout@v4` and `actions/setup-node@v4` are deprecated and being forced to Node 24. This concerns the actions' own runtime, not the project's explicit `setup-node` selection of Node 20. Update those action majors in scoped CI maintenance and verify the matrix again; this warning did not fail the release.

**Workaround:** Run the full command set in `AGENTS.md` locally before committing.

## Unsigned artifacts

**Symptom:** Windows may show SmartScreen and macOS may show Gatekeeper warnings; macOS is not notarized.

**Impact:** Installation friction and lower distribution trust.

**Workaround:** Users can evaluate development builds knowingly; do not bypass OS security controls in application code.

**Next direction:** Configure protected CI signing/notarization secrets before broad distribution.

## Cross-platform runtime acceptance is incomplete

**Symptom:** Windows has native smoke coverage, while macOS/Linux are primarily proven by historical CI builds, not full current-feature runtime tests.

**Impact:** Tray integration, WebView networking/CORS, fonts, and window-manager behavior may differ by target.

**Not fully verified:** The fixed ES2025 output and runtime API surface on the minimum supported macOS 12.x system WKWebView and representative Linux WebKitGTK versions; Bitstamp/Bybit/Gate REST CORS under macOS WKWebView/Linux WebKit; Bybit/Gate public WebSockets and historical K-line requests; the stock-perpetual search/add/display flow; the compact tray-opened About window and its exact-URL repository opener; quote-row mouse drag ordering in a real Tauri WebView on each platform; the pointer-captured screen/work-area-bounded quote-height drag under macOS/Linux window managers; the new chart/main dual-window placement, maximize, always-on-top, close-to-hide, wheel/keyboard zoom, and pointer-captured candle pan interaction in a packaged Tauri runtime outside Windows; and all Wayland tray/always-on-top combinations on those platforms. The two shipped `v1.6.2` DMGs did pass bundle and Mach-O deployment metadata checks at exactly 12.0, but they predate the chart feature.

**Next direction:** Use real target systems, including macOS 12.x, for the next release candidate; do not “fix” a platform by widening CSP or claiming TypeScript `target` supplies runtime polyfills.

## Chart selection rejects valid Bybit mappings that differ from the ticker

**Symptom:** A valid catalog product whose Bybit symbol differs from `${ticker}USDT` cannot open its chart. `createChartSelection` throws `TypeError: Invalid chart product` before the native show command; `parseChartSelection` also rejects the envelope.

**Cause:** `src/chart-selection.ts` reconstructs the expected Bybit symbol in `normalizePerpetualProduct`. This contradicts the accepted exact-symbol contract in [`MARKET_DATA.md`](MARKET_DATA.md): Bybit's official `symbol` may differ from `underlyingTicker`, and `src/watchlist.ts` preserves it.

**Evidence:** On 2026-09-07, an offline probe reused the existing AMD / `AMDSTOCKUSDT` fixture from the `US-stock perpetual directories require exact official metadata and mappings` test in `tests/watchlist.test.ts`. `parseBybitStockCatalog` accepts it, but chart selection creation throws and envelope parsing returns `null`. Adding a valid `AMD_USDT` Gate mapping and selecting Gate reproduces the rejection because the entire product is validated. These are repository fixture values, not a claim about the current online catalog.

**Impact:** Chart activation fails for this permitted product shape; main quotes and the watchlist remain usable. The chart-selection tests cover only Bybit symbols equal to ticker plus `USDT`; the 33 focused chart/UI tests passed at the 2026-09-07 takeover despite this uncovered defect.

**Current action:** Remains a separate, unimplemented correctness item in `TODO.md`; no current delivery or documentation checkpoint authorizes this fix.

**Next direction:** In a scoped correctness change, reuse the catalog/persistence Bybit symbol validation contract, retain the exact stored symbol, and add catalog-to-selection round-trip and exact-history-request regressions. Preserve Gate's canonical mapping rule, strict envelope/class validation, and unsupported-source rejection.

## Basic chart history supports three active sources

**Symptom:** The chart loads history only when the clicked quote currently comes from Coinbase, Bybit, or Gate. A row temporarily displayed from Kraken, Bitstamp, Bitfinex, or with no current source shows an explicit unsupported/unavailable message.

**Impact:** BTC/ETH can temporarily have no chart while a backup USD exchange is the active displayed source, even though the main live price remains available.

**Reason:** This first requested slice preserves exact-source truth and uses only already allowlisted browser-safe candle endpoints. Falling back to Coinbase would make the chart describe a different exchange than the clicked quote; Bitfinex REST is already rejected for missing WebView CORS.

**Next direction:** Add a provider only with a product request, current official exact-symbol/history semantics, target-WebView CORS evidence or a narrowly allowlisted native proxy, and parser/security tests. Never “solve” this limitation with cross-source substitution, a guessed symbol, or wildcard CSP.

## Current-candle synchronization: remaining data and acceptance limits

**Resolved regression:** The first current-price implementation streamed a separate quote line while candles remained at the initial history snapshot. It diverged from the newest candle close, visibly on 1m charts. Earlier axis-geometry tests missed this equality. The source correction is complete; do not treat it as an open implementation task or restore the old split. Its regression-prevention contract is in `DECISIONS.md`.

**Current behavior:** Real matching-bucket quotes and source OHLC reconciliation keep the latest candle and guide aligned. Missing new buckets retain the last actual close with “同步 K 线…”. Current verification and the distinction between source and packaged acceptance belong in `CURRENT_STATE.md`.

**Remaining boundary:** Quote updates only contain observed last prices, so the source's recent OHLC refresh repairs missed extrema and closed buckets. After a prolonged outage the bounded recent page may leave a real history gap; never interpolate it. No valid quote means no guide, and stale values say “报价滞后”. Packaged and macOS/Linux live-provider acceptance remains incomplete.

## Chart history is intentionally bounded per viewing session

**Current behavior:** Zoom-out and older-direction pan request same-source history in pages of at most 240 candles (240 time buckets for Coinbase/Gate; end-only across gaps for Bybit). A batch scans at most four pages, with one request in flight, and the chart caches at most 4,800 candles. At the cache limit the chart displays that limit; it does not claim to contain every candle the exchange has.

**Sparse history:** An empty Coinbase/Gate bounded window advances the scanned range without fabricating candles or alone proving the instrument exhausted. A valid Bybit end-only empty result covers all earlier timestamps and can confirm completion. If four pages remain insufficient and origin is unconfirmed, the user can continue loading. Network failures retain the chart and allow retry. Provider proof rules are authoritative in `MARKET_DATA.md`.

**Pan/start semantics:** Both edges permit blank space until one complete end-candle slot remains. The 2026-09-08 cache-first “已加载起点” marker was rejected by the user and corrected on 2026-09-09: only the confirmed earliest retained candle gets “历史起点”. Confirmed completion removes the continue action and stops both demand and prefetch. Blank space has no fabricated candle/time marker. A failed/nonadvancing demand page or unfinished four-page batch pauses automatic continuation until explicit retry or loaded-range/reset recovery; retain the held-pointer retry regression.

**Origin evidence limitations:** Coinbase trade-ID/cursor verification and Gate contract creation metadata give conservative same-source lower bounds; Bybit end-only empty results cover all older timestamps. A missing/failed/contradictory metadata probe leaves origin unconfirmed and the status says so; reloading creates a new probe opportunity. Do not replace this with one empty window, `before=0` Coinbase trades, Bybit formal `launchTime`, or a cache cap. Metadata 429/403 preserve candles and impose a one-time navigation cooldown. See `MARKET_DATA.md` for the precise contract and `CURRENT_STATE.md` for current verification.

**Advance buffer:** The selected chart targets a 480-candle left buffer, refilling by whole pages (usually 720 total at the initial latest-120 view, with 600 candles before that view), with a one-second delay between speculative pages. Empty/nonadvancing/error responses or four insufficient sparse pages pause prefetch; successful demand can resume it. HTTP 429/403 pause older requests for 60 seconds/10 minutes in the current navigation instance. This is not a provider-wide limiter across deliberate chart reloads, main feeds, or other applications. Sparse history and fast navigation beyond the buffer can still require a visible load; the chart does not promise an offline copy of all exchange history.

**Zoom distinction:** The 4,800-candle limit bounds real cached data, not visual slots. The completed extra-space refinement permits further compression after all retained history fits; see the zoom-reserve decision in `DECISIONS.md` and current tests/evidence in `CURRENT_STATE.md`. Do not restore the earlier all-240 initial viewport, full-series zoom ceiling or fixed 12px body-width cap as workarounds.

## Stock-related products are exchange derivatives, not shares

**Symptom:** Entries such as `MU.P` display a USDT-settled perpetual contract from Bybit or Gate, not Micron shares listed on Nasdaq.

**Impact:** Contract price, trading hours, funding, leverage, liquidity, regional eligibility, and counterparty risk can differ from the underlying stock. Availability can also change by exchange or jurisdiction.

**Current behavior:** Search and selected rows identify this class with `.P` and `USDT永续`; mixed watchlists show `USD/USDT`. Daily change uses the selected contract exchange's own UTC+0 open. The app never claims share ownership and never borrows a stock-market open.

**Constraint:** Bybit/Gate symbols merge only when their canonical ticker is exactly equal. Similar aliases such as `AAPL` and `AAPLX` remain separate products rather than guessed equivalents.

## Entirely delisted persisted products are not auto-removed

**Symptom:** If a previously selected stock-related contract disappears from every successful live directory, the saved row remains instead of being silently deleted.

**Impact:** Its exact old source code can reconnect/fail until the quote becomes stale; the user may need to remove it manually.

**Reason:** A missing catalog entry is ambiguous across transient regional filtering, provider outages, and true delisting. The refresh path preserves user selection and distinguishes a failed source directory from an authoritative mapping removal on products still supplied by another source.

**Next direction:** Add explicit unavailable-product UI only with a product request and provider-specific delisting evidence; do not guess a replacement symbol.

## Linux and hidden-window OS limitations

**Symptom:** Some Linux/Wayland environments may not show a tray icon or may constrain always-on-top. Operating systems may throttle a hidden WebView.

**Impact:** Tray discovery and background tick processing can vary even though the process remains alive.

**Cause:** Desktop StatusNotifier/AppIndicator/compositor support and OS power/background policy.

**Workaround:** Document supported desktop expectations. On restore/online/visibility, the app reconnects and refreshes. It cannot override UAC/security desktop, lock screens, exclusive fullscreen, or arbitrary compositors.

## Isolated CSS parse token

**Symptom:** `src/styles.css:349` contains an unmatched extra `}` after the marker-color rules.

**Impact:** Current browsers ignore the stray token and the native layout smoke passed, but no CSS linter guards syntax and future parser/context changes could expose a styling issue.

**Reproduction:** Inspect lines 341–349. This is stable by source inspection.

**Current action:** None in this documentation-only checkpoint; CSS maintenance was not requested.

**Next direction:** Remove it in a separately authorized maintenance change and rerun UI/native layout checks.

## Unused native minimize command

**Symptom:** `minimize_window` remains in `src-tauri/src/lib.rs`, `build.rs`, and custom permission metadata, but the frontend no longer has or invokes a minimize button.

**Impact:** Small unnecessary IPC surface and maintenance ambiguity; no current behavior failure.

**Cause:** The title-bar button was replaced by watchlist management while native compatibility code remained.

**Current action:** None in this checkpoint.

**Next direction:** Remove it consistently in a scoped maintenance change, or document a renewed caller if the product requirement changes.

## Windows development network diagnostics

**Symptom:** Node/CLI WebSocket calls can time out or report certificate-chain errors while the Tauri WebView works.

**Cause:** Windows WebView2 follows system Internet Settings proxy behavior; Node/CLI behavior and CA configuration can differ. At an earlier Windows checkpoint, a system proxy was enabled; that address was environment evidence, not application configuration.

**Already ruled out historically:** A generic WebSocket echo endpoint was reachable while some exchange direct paths were not, so “WebSocket is globally disabled” was not the cause.

**Workaround:** Diagnose the active proxy/CA path separately for CLI and WebView. Never hardcode the developer's proxy or disable TLS verification in product code.

## Benign MSVC linker message

**Symptom:** Windows Rust build/test can print a `linker_messages` warning containing Chinese text about creating an import library and `.exp` object.

**Impact:** None observed; cargo test/check/clippy and release build pass.

**Workaround:** Do not misreport it as a Clippy or application warning. Reinvestigate only if it changes severity or accompanies a build failure.

## Older published Release text mismatch

**Symptom:** Older Release bodies emphasize Windows and may show a space-form Windows filename (`Crypto Top_...`) while the actual v1.1.0+ asset uses `Crypto.Top_...`; all five assets are present.

**Impact:** Documentation confusion, not a missing binary.

**Workaround:** Use the actual asset list, not copied body text, when downloading.

**Next direction:** `v1.6.2` now has a verified UTF-8 Release body listing all five exact asset filenames. If the user requests historical cleanup, update older Release text individually and verify each page afterward.
