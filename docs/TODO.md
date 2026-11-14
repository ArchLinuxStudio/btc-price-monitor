# Remaining Work

This is an executable backlog, not authorization to start work. A future agent must still follow the user's requested scope.

Standing validation preference: automated checks must not take over desktop windows, focus, mouse or keyboard or interrupt computer use. Provide local installers for user-performed interactive/native acceptance; do not install or drive the app for testing. Runtime coverage stays unverified until user feedback, rather than blocking delivery on desktop-control tests.

## P0 — Blocking

None for the completed settings/system-status/temperature implementation. The closed-thread handoff, package delivery and verification state are recorded in `CURRENT_STATE.md`. A separate confirmed chart-selection defect is listed below.

## P1 — Chart correctness

- [ ] Preserve valid Bybit symbols that differ from the underlying ticker across chart selection.
  - The existing AMD / `AMDSTOCKUSDT` catalog fixture is accepted by the watchlist but rejected by `src/chart-selection.ts`; see `KNOWN_ISSUES.md` for the offline reproduction.
  - Done when catalog-to-selection creation/serialization/parsing preserves the exact permitted Bybit symbol, including a product whose active source is Gate, and regressions verify the unchanged exact history request. Keep strict envelope/product-class checks, Gate's canonical mapping rule, and unsupported-source rejection. This backlog item is not authorization to implement it.

## P2 — Release quality and cross-platform confidence

- [ ] Collect user-performed system-status/temperature acceptance from the latest Windows preview in `CURRENT_STATE.md`.
  - CPU temperature was confirmed working by the user on 2026-11-14. Verify upload appears before download with matching typography/alignment, the installer handles PawnIO, double-click startup requests administrator access, enabled login startup retains that access, and unsupported DIMM temperature stays honest. The `44px` footer is unchanged. DIMM temperature requires actual sensor/chipset support. Automated checks are in `CURRENT_STATE.md`; no agent-driven driver installation, task registration or desktop automation. Linux/macOS runtime acceptance remains target-dependent.

- [ ] Collect user-performed settings and elevated login-autostart acceptance from the latest local preview.
  - Verify tray “设置” opens one reusable window, closing hides it, and the switch enables/disables launch on the next user login. Windows preview and automated results are in `CURRENT_STATE.md`; macOS 12/Linux acceptance requires a suitable target package. Do not launch/install or change this machine's autostart settings on the user's behalf without an explicit request.

- [ ] Collect the user's installed-artifact chart acceptance from the delivered local Windows preview.
  - The latest preview in `CURRENT_STATE.md` also includes the previously delivered restyle and smooth-history fix. Their implementation checks are retained in Git history; chart code was unchanged by this thread. Rebuild only if a later change or missing local artifact requires it. User acceptance remains unreported for main/chart coexistence, layout/controls/OHLC, live exact-source candles/price guide, smoother history browsing, zoom/pan/reset and close-to-hide. Older native smoke evidence does not verify this preview. Do not install or drive it on the user's behalf without a new explicit request.

- [ ] Collect user-performed runtime acceptance on supported macOS and Linux environments after the next relevant release candidate.
  - Done when macOS bundle/deployment metadata reports the 12.0 floor and startup plus the fixed ES2025 output are exercised on macOS 12.x; tray visibility/actions (including About and its scoped GitHub opener), monitor/About/chart close-to-hide, chart/main dual-window work-area maximize and always-on-top interaction, all five candle intervals plus chart wheel/button/keyboard zoom, pointer-captured pan and reset, crosshair/axis markers and paced prefetch/cancellation, main-row mouse/keyboard activation/ordering and restart persistence, screen-bounded quote-height drag (fixed `208px` width, expansion to the available work-area/content limit, overflow behavior, and `170px` management cap), Coinbase/Bybit/Gate catalog and WebSocket/REST connectivity, stock-perpetual search/display, UTC rollover, and packaging startup are recorded for macOS arm64/x64 as available plus a mainstream Linux desktop/Wayland setup.

- [ ] Add signing/notarization before broad end-user distribution.
  - Done when Windows artifacts are signed and macOS artifacts use Developer ID plus notarization, with secrets stored only in protected CI configuration.

- [ ] Harden version consistency checks in the release workflow.
  - Done when the tag is checked against `package.json`, both root entries in `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`, with a regression test or demonstrated failing mismatch.

- [ ] Add an ordinary main/PR quality workflow or extend CI coverage.
  - Done when non-tag changes run the full TypeScript/frontend tests and Rust fmt/test/check/clippy set without publishing artifacts or Releases. Include the deprecated checkout/setup-node action runtimes recorded in `KNOWN_ISSUES.md` in the scoped CI upgrade, and verify the release matrix afterward.

## P3 — Known technical debt

- [ ] Remove or deliberately restore the unused `minimize_window` IPC command.
  - Done when `src-tauri/src/lib.rs`, `src-tauri/build.rs`, permissions, architecture docs, and tests agree on the reduced command surface; closing must still hide to tray.

## Optional / Revisit only with a product request

- [ ] Add a sanitized real sparse-market Bitstamp OHLC fixture if provider behavior is being changed or investigated.
  - Done when the fixture demonstrates empty/zero-volume versus first-trade buckets and locks the intended UTC-open result without permitting cross-source substitution.

- [ ] Expand custom-product backup coverage for Kraken or Bitfinex using an official, exact, browser-safe instrument directory (or a narrowly allowlisted Rust command).
  - This item applies only to real-USD crypto spot coverage; it is not permission to mix stock-related perpetual semantics into those providers.
  - Done when no pair is guessed, true-USD semantics and licenses are verified, CSP stays narrow, and mapping/failover/UTC tests cover aliases and missing products.

- [ ] Expand exact-source chart history beyond Coinbase/Bybit/Gate only if broader K-line coverage is requested.
  - Done when each added Kraken/Bitstamp/Bitfinex route uses the exact currently displayed product/source, current official history semantics, target WebView CORS evidence or a narrowly allowlisted native boundary, and parser/abort/CSP tests; no cross-source fallback or synthetic candle is permitted.

Settings, opt-in autostart, system status and temperature collection are implemented; only the explicit acceptance items above remain. Do not add alerts, auto-update, or unrelated features merely because they are absent.
