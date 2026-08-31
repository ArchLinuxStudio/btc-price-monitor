# Known Issues and Limitations

There is no known blocking business bug and no known flaky test at this checkpoint. This document records real limitations and technical debt; actionable work is linked to [`TODO.md`](TODO.md).

## No normal main/PR CI and incomplete CI checks

**Symptom:** The desktop workflow triggers only for manual dispatch or `v*` tags. It now runs the complete TypeScript/frontend `npm run check`, but it still does not run Rust fmt/test/check/clippy.

**Impact:** A pushed main commit can have no GitHub status even when local verification was performed; Rust quality regressions may be discovered only at release time.

**Current evidence:** See the dated verification snapshot in [`CURRENT_STATE.md`](CURRENT_STATE.md); query GitHub again for a future commit.

**Workaround:** Run the full command set in `AGENTS.md` locally before committing.

## Unsigned artifacts

**Symptom:** Windows may show SmartScreen and macOS may show Gatekeeper warnings; macOS is not notarized.

**Impact:** Installation friction and lower distribution trust.

**Workaround:** Users can evaluate development builds knowingly; do not bypass OS security controls in application code.

**Next direction:** Configure protected CI signing/notarization secrets before broad distribution.

## Cross-platform runtime acceptance is incomplete

**Symptom:** Windows has native smoke coverage, while macOS/Linux are primarily proven by historical CI builds, not full current-feature runtime tests.

**Impact:** Tray integration, WebView networking/CORS, fonts, and window-manager behavior may differ by target.

**Not fully verified:** The fixed ES2025 output and runtime API surface on the minimum supported macOS 12.x system WKWebView and representative Linux WebKitGTK versions; macOS bundle/deployment metadata at the new 12.0 floor; Bitstamp/Bybit/Gate REST CORS under macOS WKWebView/Linux WebKit; Bybit/Gate public WebSockets; the stock-perpetual search/add/display flow; the compact tray-opened About window and its exact-URL repository opener; quote-row mouse drag ordering in a real Tauri WebView on each platform; the pointer-captured screen/work-area-bounded quote-height drag under macOS/Linux window managers; and all Wayland tray/always-on-top combinations on those platforms.

**Next direction:** Use real target systems, including macOS 12.x, for the next release candidate; do not “fix” a platform by widening CSP or claiming TypeScript `target` supplies runtime polyfills.

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

**Symptom:** `src/styles.css:277` contains an unmatched extra `}` after the marker-color rules.

**Impact:** Current browsers ignore the stray token and the native layout smoke passed, but no CSS linter guards syntax and future parser/context changes could expose a styling issue.

**Reproduction:** Inspect lines 269–279. This is stable by source inspection.

**Current action:** None in this checkpoint; the user explicitly prohibited fixing newly found issues.

**Next direction:** Remove it in a separately authorized maintenance change and rerun UI/native layout checks.

## Unused native minimize command

**Symptom:** `minimize_window` remains in `src-tauri/src/lib.rs`, `build.rs`, and custom permission metadata, but the frontend no longer has or invokes a minimize button.

**Impact:** Small unnecessary IPC surface and maintenance ambiguity; no current behavior failure.

**Cause:** The title-bar button was replaced by watchlist management while native compatibility code remained.

**Current action:** None in this checkpoint.

**Next direction:** Remove it consistently in a scoped maintenance change, or document a renewed caller if the product requirement changes.

## Windows development network diagnostics

**Symptom:** Node/CLI WebSocket calls can time out or report certificate-chain errors while the Tauri WebView works.

**Cause:** Windows WebView2 follows system Internet Settings proxy behavior; Node/CLI behavior and CA configuration can differ. The current machine had a system proxy enabled at checkpoint time, but that address is not application configuration.

**Already ruled out historically:** A generic WebSocket echo endpoint was reachable while some exchange direct paths were not, so “WebSocket is globally disabled” was not the cause.

**Workaround:** Diagnose the active proxy/CA path separately for CLI and WebView. Never hardcode the developer's proxy or disable TLS verification in product code.

## Benign MSVC linker message

**Symptom:** Windows Rust build/test can print a `linker_messages` warning containing Chinese text about creating an import library and `.exp` object.

**Impact:** None observed; cargo test/check/clippy and release build pass.

**Workaround:** Do not misreport it as a Clippy or application warning. Reinvestigate only if it changes severity or accompanies a build failure.

## Published Release text mismatch

**Symptom:** Older Release bodies emphasize Windows and may show a space-form Windows filename (`Crypto Top_...`) while the actual v1.1.0+ asset uses `Crypto.Top_...`; all five assets are present.

**Impact:** Documentation confusion, not a missing binary.

**Workaround:** Use the actual asset list, not copied body text, when downloading.

**Next direction:** If the user requests Release-copy cleanup, update with a UTF-8 five-platform table and verify the page afterward.
