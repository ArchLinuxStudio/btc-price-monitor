# Current Development State

Checkpoint date: 2026-09-08 (Asia/Shanghai)

## Current Objective

The user explicitly authorized pushing the code on 2026-09-08. Prepare and push the complete documented chart feature, including the corrected zoom, crosshair/axis markers, and paced history prefetch, to the existing `origin/main`. The source has passed the full frontend check and deterministic browser interaction tests and is included in the latest local Windows test installer; fresh Rust checks also passed before committing. This is a source push; version changes, tags, published packages, and the separate Bybit selection-mapping fix are not part of the request.

## Current Status

- `main` tracks `origin/main`; both point to `d68af6dd423b66f00d97a9b62e6a598fa367794f` with no ahead/behind commits.
- The complete row-activation, chart-window, exact-source candle-history, and zoom/pan slice exists only in the dirty working tree. It has not been committed, pushed, tagged, or published.
- All source/package version fields remain `1.6.2`. Published tag `v1.6.2` points to older release source `894dffb` and therefore does **not** contain the chart work. Failed tags `v1.6.0`/`v1.6.1` and published `v1.6.2` are immutable.
- The local unsigned installer at `src-tauri/target/release/bundle/nsis/Crypto Top_1.6.2_x64-setup.exe` was rebuilt on 2026-09-08 at 13:08 (Asia/Shanghai) with zoom, crosshair, and paced prefetch. Its identical test copy is `artifacts/local-test-2026-09-08-131009/Crypto.Top_1.6.2_crosshair-prefetch-test_x64-setup.exe`. The older named zoom-test copy at `artifacts/local-test-2026-09-08-081230/` was preserved. These are local dirty-tree builds, not the published `v1.6.2` Windows asset. The new installer was not executed. The debug executable/native evidence below predates the crosshair/prefetch improvements.
- No unrelated user edit could be safely isolated from the existing feature/checkpoint changes. Preserve the entire worktree unless the user explicitly authorizes a commit, cleanup, or release operation.

## Git Worktree Snapshot

Captured on 2026-09-08 after the crosshair/prefetch correction. `git status --short --branch` reported no staged changes.

Modified tracked files (16):

```text
README.md
docs/ARCHITECTURE.md
docs/CURRENT_STATE.md
docs/DECISIONS.md
docs/KNOWN_ISSUES.md
docs/MARKET_DATA.md
docs/TODO.md
package.json
scripts/frontend.ts
src-tauri/build.rs
src-tauri/capabilities/main.json
src-tauri/src/lib.rs
src-tauri/tauri.conf.json
src/index.html
src/main.ts
tests/ui.test.ts
```

Untracked files (14):

```text
src-tauri/capabilities/chart.json
src/candle-history.ts
src/chart-crosshair.ts
src/chart-navigation.ts
src/chart-selection.ts
src/chart-viewport.ts
src/chart.css
src/chart.html
src/chart.ts
tests/candle-history.test.ts
tests/chart-crosshair.test.ts
tests/chart-navigation.test.ts
tests/chart-selection.test.ts
tests/chart-viewport.test.ts
```

These files together form the unreleased chart feature and its documentation/tests. Git cannot independently prove their human provenance, so do not split, overwrite, reset, delete, or stage only a guessed subset before reviewing the complete diff.

## Completed

- Quote rows now open the selected product/source in a reusable chart window by mouse or `Enter`/`Space`; row drag still suppresses its synthetic click and display-only actions do not reconnect `PriceFeed`.
- Rust owns one pre-created hidden chart window, maximizes it to the main monitor's work area without exclusive fullscreen, leaves the `208px` main monitor visible, and hides/reuses the chart on close.
- The local chart supports five intervals and exact active-source history for Coinbase, Bybit, and Gate only. Each page covers at most 240 time buckets; older pages use exclusive time boundaries, retain sparse data, and never substitute an unsupported source.
- The default/reset viewport shows the latest 120 candles (or all available if fewer). Initial zoom-out works; further zoom-out or dragging beyond the loaded left edge loads more same-source history. Candle spacing and body width scale together, without the old 12px body-width cap.
- `ChartNavigation` retains pending viewport intent and prepends older candles without changing the selected time anchor. It allows one request at a time, at most four pages per interaction batch, and a 4,800-candle cache. Empty ranges can be queried further; failures keep the current chart and expose retry. Reverse zoom, reset, End, product/interval changes, and hiding cannot be overwritten by obsolete requests.
- Pointer/wheel, `＋/−`, drag, focused keyboard navigation, and reset remain supported, with a 12-candle minimum. Wide chart headers reserve space for the main monitor's default top-right position so it does not cover zoom controls.
- Hover and drag use a crosshair cursor, dashed horizontal/vertical guides, pointer-price and real-candle UTC time axis markers. An independent transparent canvas handles pointer motion without repainting candles; the renderer shares its visible padded price range with pure projection math. Markers stay inside the stage and clear on leave/blur/cancel/hide/reload.
- A one-second paced prefetch maintains 480 candles before the visible left edge, normally warming 240 to 720 cached candles without changing the latest-120 view. It shares demand's single flight, shifts drag/time anchors on prepend, and cancels timers with the selection lifecycle. Empty/nonadvancing/error responses or four insufficient sparse pages pause speculation; a successful demand page can resume it. HTTP 429/403 add a 60-second/10-minute older-request cooldown in that navigation instance.
- CSP origins and narrow per-window capabilities remain unchanged except for the fixed chart commands/event required by this feature. No framework, bundler, chart library, or arbitrary window permission was added.

## In Progress

- Reviewing and committing the complete documented feature, refreshing native checks, and pushing to the existing `origin/main` under the user's explicit authorization. No staged files existed at the start; the live remote `main` still matched `d68af6d` before the push.
- Current crosshair/prefetch native/installer runtime acceptance and macOS/Linux runtime coverage remain unverified. The user accepted the preceding basic zoom logic; this does not establish full packaged or cross-platform acceptance.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `AGENTS.md` | Development entry point, non-negotiable product constraints, verification commands, and change discipline |
| `docs/INDEX.md` | Documentation authority and selective reading routes |
| `docs/ARCHITECTURE.md` / `docs/DECISIONS.md` | Stable module boundaries and the accepted exact-source, separate-window chart contract |
| `docs/MARKET_DATA.md` | Authoritative provider, exact-symbol, real-USD/perpetual, and candle-source semantics |
| `docs/TODO.md` / `docs/KNOWN_ISSUES.md` | Unauthorized backlog and real limitations/workarounds |
| `docs/RELEASE.md` | Versioning, package/release procedure, immutable-tag recovery, and artifact rules |
| `src/main.ts` / `src/index.html` | Quote-row mouse/keyboard activation, current-source selection snapshot, and drag-click suppression |
| `src/chart.html` / `src/chart.css` / `src/chart.ts` | Maximized candle viewer, interval/viewport controls, visible-range canvas drawing, pointer/wheel/keyboard navigation, status/accessibility, and chart-window lifecycle |
| `src/chart-viewport.ts` | Pure minimum-12 floating viewport normalization, anchored zoom, fractional pan, reset detection, and visible integer bounds |
| `src/chart-crosshair.ts` / `tests/chart-crosshair.test.ts` | Pure visible-candle crosshair projection, price mapping, edge/resize/prepend/invalid-input regressions |
| `src/chart-navigation.ts` / `tests/chart-navigation.test.ts` | Default/reversed zoom intent, paced prefetch and bounded demand loading, stable prepend anchors, cancellation, sparse/error/cooldown recovery, and behavioral regressions |
| `src/candle-history.ts` / `src/chart-selection.ts` | Exact-source candle requests/parsers and validated versioned cross-window selection state |
| `src-tauri/src/lib.rs` / `build.rs` / `tauri.conf.json` | Bounded selection slot, fixed chart commands/event, pre-created chart envelope, placement/maximize, and hide/reuse lifecycle |
| `src-tauri/capabilities/main.json` / `chart.json` | Narrow, window-specific chart command/event permissions |
| `scripts/frontend.ts` / `package.json` | Clean static emit and the authoritative TypeScript/test/build commands |
| `tests/candle-history.test.ts` / `chart-selection.test.ts` / `chart-viewport.test.ts` / `ui.test.ts` | Current chart data, transfer, viewport, UI/native-configuration regressions |

## Current Implementation

The stable monitor, watchlist, About, sizing, tray, and market-feed design remains as documented in [`ARCHITECTURE.md`](ARCHITECTURE.md); the current uncommitted slice adds the chart path without changing those contracts.

`src/main.ts` serializes a strict version-1 product/current-`DisplayQuote.marketSource` envelope and invokes only `show_chart_window`. Rust validates the opaque payload against a 4096-byte limit, stores one selection, shows/maximizes the pre-created chart window on the main monitor's work area, and emits `chart-selection-changed`. The main monitor is not hidden. Closing the chart hides it and restores the main window.

`src/candle-history.ts` supports semantically exact Coinbase real-USD spot and Bybit/Gate stock-related USDT-perpetual history for five intervals. `fetchCandleHistoryPage` returns at most 240 valid candles plus the scanned-window `nextBefore` cursor. Its optional `before` is exclusive; empty/sparse pages still advance the cursor, and zero marks the timestamp boundary. The existing array-returning `fetchCandleHistory` interface remains compatible. Unsupported sources are rejected before `fetch`.

`src/chart-viewport.ts` owns pure continuous candle-unit math, a latest-120 default/reset, a 12-candle minimum, and proportional candle geometry. `src/chart-navigation.ts` owns loaded history and pending navigation intent. It serially fetches up to four older pages per batch, preserves time anchors on prepend, and caps the cache at 4,800 candles with a visible limit message. A small reverse zoom immediately uses the rendered viewport instead of an unseen pending range. `src/chart.ts` synchronizes the canvas and drag origin with that state; drawing remains animation-frame coalesced and clipped, with visible-range price/time axes and accessible summaries. Product/interval changes or hiding cancel obsolete work; resize preserves candle position. Above 960px width, the header reserves 248px at the right for the monitor's default placement; arbitrary user-moved overlap is not prevented.

The frontend remains strict TypeScript (`ES2025` target/library, native `ES2022` modules) emitted as local unbundled files. The chart introduces no provider, dependency, general native window permission, or CSP-origin expansion.

The crosshair is a separate, animation-frame-coalesced transparent canvas plus noninteractive axis markers. `chart-crosshair.ts` snaps only to visible real candle centers and maps pointer height with the renderer's padded extrema; UTC labels use that candle's actual timestamp. `ChartNavigation.startPrefetch()` runs after instance assignment, including empty initial pages (which do not trigger speculative fetches until manual recovery supplies data). Its 480-candle left buffer is paced at one second between speculative pages and yields to demand. Empty/nonadvancing/error pages and four insufficient sparse pages pause speculation. HTTP 429/403 cooldowns apply only to the current navigation instance, not globally to all provider traffic or deliberate interval/reopen reloads. See `DECISIONS.md` and `MARKET_DATA.md` for the accepted policy and official limits.

## Current Problems

- One confirmed chart-selection defect: `src/chart-selection.ts` requires a Bybit symbol to equal `${ticker}USDT`, while the existing catalog/persistence contract permits an exact official symbol that differs from the underlying ticker. The existing AMD / `AMDSTOCKUSDT` repository fixture passes catalog parsing but throws `TypeError: Invalid chart product` when opening its chart; the same product is rejected even with a valid active Gate mapping. Main quotes are unaffected. This is an offline fixture reproduction, not evidence that the example is currently listed online. See `KNOWN_ISSUES.md`; no product fix was made during takeover.
- No known flaky test. The current selection tests do not cover this valid noncanonical Bybit mapping.
- The requested first chart slice intentionally has history adapters only for the exact active Coinbase, Bybit, or Gate source. If a clicked USD quote is currently displayed from Kraken, Bitstamp, Bitfinex, or has no source yet, the chart reports that limitation instead of substituting Coinbase; broader exact-source coverage requires a separate product request and provider/CORS work.
- The shipped DMGs passed metadata/deployment-target gates at exactly macOS 12.0, but startup and ES2025 output have not been exercised on a real macOS 12.x system. Representative Linux WebKitGTK runtime acceptance is also incomplete.
- Real native mouse ordering/edge scrolling and beyond-eight/work-area height dragging are not fully smoke-tested across Windows, macOS, and Linux; compact About/opener behavior and chart/main maximize/always-on-top/close-to-hide plus chart pointer/wheel navigation likewise lack current macOS/Linux packaged-runtime coverage.
- Published artifacts are unsigned; Windows signing and macOS Developer ID/notarization remain future release-quality work.
- Known non-blocking technical debt includes the isolated extra `}` in `src/styles.css` and the unused native `minimize_window` command. Do not fix either without a separately authorized maintenance task.
- Further limitations and their workarounds are in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); executable but unauthorized follow-up items are in [`TODO.md`](TODO.md).

## Verification State

Source-push preflight on 2026-09-08:

- Reviewed the complete documented 30-file feature scope and staged it explicitly; installers/logs remain ignored. No unrelated changes or credential-pattern matches were found. The existing remote is `https://github.com/ArchLinuxStudio/btc-price-monitor.git`, and live `refs/heads/main` matched local `d68af6d` before the source commit.
- Fresh `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`, `cargo test --locked --manifest-path src-tauri/Cargo.toml` (7/7), `cargo check --locked --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`: passed. Only the documented benign MSVC import-library message appeared during test compilation; Clippy emitted no warnings.
- The same-turn 152-test frontend check, browser regression, and local NSIS build evidence below remain applicable; no product source changed afterward. Staged `git diff --check` passed with no unstaged work.

Crosshair/prefetch verification on 2026-09-08:

- `npm.cmd run check`: passed strict application/test TypeScript checks, 152/152 Node tests (including 32 navigation and 8 crosshair projection cases), and clean frontend emit. Log: `artifacts/crosshair-prefetch-check.log` (ignored). There is no separate lint script.
- Deterministic Chromium regression passed at `1440×900` and `640×400`, device pixel ratio 2: crosshair cursor during hover/drag, both dashed guides, actual UTC candle/time and continuous pointer-price labels, top/bottom alignment, unclipped markers, no candle-layer redraw on hover, and clearing on leave/interval/close. Initial 120/240 warmed to 120/720 with >=1-second page spacing, unchanged candle geometry/time/price anchors, immediate zoom-out to 330 from the buffer, preserved drag scale after a quiet prefetch failure, no automatic error retries, empty-page manual recovery enabling prefetch, and close cancelling its queued request. No page errors/console warnings. Harness and results/screenshots: `artifacts/chart-crosshair-prefetch-smoke.mjs` and `artifacts/chart-crosshair-prefetch-2026-09-08/` (ignored).
- `git diff --check`: passed. No Rust, capability, CSP, dependency, or version change was needed for these two improvements. Earlier native evidence below applies to the preceding zoom implementation, not the current crosshair/prefetch runtime.
- `npm.cmd run build:windows`: passed clean frontend build, optimized Rust build, and x64 NSIS packaging. Only the documented benign MSVC import-library message appeared. Log: `artifacts/local-installer-crosshair-prefetch-2026-09-08.log` (ignored).
- New test copy: `artifacts/local-test-2026-09-08-131009/Crypto.Top_1.6.2_crosshair-prefetch-test_x64-setup.exe`, 1,235,631 bytes, product/file version `1.6.2`, Authenticode `NotSigned`. SHA-256: `B51F4EF2D2D87B20C440A008CF51BF0D5BCF6FE9D928302C4E821045A3FC8F77`; canonical output and copy match. `build-info.json` and `SHA256SUMS.txt` are alongside it. Generated NSIS license-page metadata and the decoded packaged GPL license match the source. The installer was not run; no installed process was changed, and no commit, push, tag, release, or source-version change occurred.

Earlier zoom-only installer verification on 2026-09-08 (historical; the canonical NSIS output has since been replaced above):

- `npm.cmd run build:windows`: passed the clean frontend build, optimized Rust build, and x64 NSIS packaging. Build log: `artifacts/local-installer-build-2026-09-08.log` (ignored). Only the documented benign MSVC import-library message appeared.
- Test copy: `artifacts/local-test-2026-09-08-081230/Crypto.Top_1.6.2_zoom-test_x64-setup.exe`, 1,232,936 bytes, product/file version `1.6.2`, Authenticode `NotSigned`.
- SHA-256: `42DE2A845A5D339055FC1424F31707AA24DDBE17EF268B77E30CF134527655D7`. Original and copied installers have identical hashes. `build-info.json` and `SHA256SUMS.txt` are alongside the test copy.
- All six source/lock/config version fields agree at `1.6.2`. Freshly generated NSIS metadata includes the GPL license page and its nonempty `license_file` matches the source `LICENSE` after decoding.
- The installer has not been executed or installed; user acceptance remains pending. Source versions, commits, tags, and published Releases were not changed.

Final zoom verification on Windows on 2026-09-08:

- `npm.cmd run check`: passed strict application/test TypeScript checks, 129/129 Node tests (18 history-page, 17 navigation, and 13 viewport tests), and clean frontend emit. Log: `artifacts/zoom-final-check.log` (ignored).
- `cargo build --locked --manifest-path src-tauri/Cargo.toml`: passed for the current debug executable; only the documented benign MSVC import-library message appeared. No Rust, capability, CSP, dependency, or version change was needed for this zoom correction.
- Deterministic browser regression passed at `1440×900` and `640×400`: initial 120 → 168 → 330 visible candles with 480 loaded, monotonically smaller spacing/body width on zoom-out, larger bodies on zoom-in, wheel navigation, drag/prepend without scale jumps, reset, error/retry to 960 loaded candles, interval changes ignoring older responses, and wide-toolbar clearance. Screenshots and measurements: `artifacts/chart-zoom-2026-09-08/`; harness: `artifacts/chart-zoom-smoke.mjs` (all ignored). No page errors or console warnings were observed.
- Real Windows Tauri debug runtime loaded Coinbase UNI hourly history: initial 120/240 → 168/240 → 236/240 → 330/480, with the visible start moving earlier. Native wheel zoom-in, latest-120 reset, main/chart coexistence, and Escape close-to-hide restoring the main window passed. This is real provider/WebView evidence, not an installer or cross-platform test.
- `git diff --check`: passed after final documentation updates. Existing dirty work was preserved; no commit, push, version change, tag, release, or installation was performed.

The following earlier evidence is retained for provenance; it is not a claim that the old full Rust or installer checks were repeated for this frontend-only correction.

Takeover verification on Windows on 2026-09-07:

- Git and the chart-related dirty source/diff were reviewed against this handoff: `main` and the local `origin/main` ref still equal `d68af6d`, with the same 16 modified tracked files, 10 untracked files, and no staged changes. No remote fetch was performed.
- `npm.cmd run typecheck`: passed strict application/test TypeScript checks.
- `node --import=tsx --test --test-reporter=dot tests/candle-history.test.ts tests/chart-selection.test.ts tests/chart-viewport.test.ts tests/ui.test.ts`: passed, 33/33 tests.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml chart_selection_is_bounded_by_utf8_bytes`: passed, 1/1 selected Rust test; only the documented benign MSVC import-library message appeared.
- `git diff --check`: passed after the takeover documentation update.
- A separate offline probe reused the AMD / `AMDSTOCKUSDT` fixture from `tests/watchlist.test.ts`: catalog parsing succeeds, but chart selection creation throws and parsing rejects it for both Bybit and a Gate-mapped version of the product. This confirms an uncovered product defect despite the passing suite.
- Product source was preserved. Only `CURRENT_STATE.md`, `KNOWN_ISSUES.md`, and `TODO.md` were updated to record the finding and verification. No full suite, frontend emit, installer build/execution, or runtime acceptance was repeated.

Full verification retained from the preceding 2026-09-07 checkpoint, not rerun in this takeover:

- `npm.cmd run check`: passed; strict application/test TypeScript checks, 102/102 Node tests including 9 viewport-math cases, and a clean frontend emit.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 7/7 Rust tests; only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed with no Clippy warnings.
- `git diff --check`: passed after the documentation edits; only expected LF-to-CRLF working-copy notices were printed.
- There is no standalone frontend lint script. Strict TypeScript checking is part of `npm.cmd run check`; Rust linting is the Clippy command above.

Build/runtime evidence retained from 2026-09-02:

- `npm.cmd run build:windows` passed. The installer still existed and was rehashed on 2026-09-07 at `src-tauri/target/release/bundle/nsis/Crypto Top_1.6.2_x64-setup.exe` (1,229,641 bytes, SHA-256 `89BDF998A0DD76F8066861B27BF38041671FEEE5CE9CF9DCEE9727A9670A6614`, unsigned, version `1.6.2`). It was not rebuilt, run, or installed during this documentation-only checkpoint.
- A deterministic browser fixture previously rendered 180 candles at `1440×900` and `640×400` and verified button/wheel zoom, pointer-anchored zoom, drag and keyboard pan, Home/End, reset, interval reset, ARIA state, and no console warnings/errors. It was not rerun on 2026-09-07 and does not prove Tauri multi-window behavior or live-provider CORS.
- Published `v1.6.2` at `894dffb` passed Actions run `33468480211` with all five platform assets and both macOS 12 gates. That immutable release predates the chart work; Git/GitHub and `docs/RELEASE.md` remain authoritative for its detailed evidence.

Not verified for this unreleased slice: installer execution; a packaged-Windows click-through of main/chart coexistence, live Coinbase/Bybit/Gate history, viewport interactions, and close paths; real macOS 12/WebKit or Linux WebKitGTK runtime behavior; signing or notarization.

## Next Recommended Action

Finish the authorized source commit/push after review and checks, verify the remote `main` hash against the local revision, then update this checkpoint with the actual commit and delivery evidence. Preserve all documented chart files as one coherent feature; ignored installers/logs must remain local. Do not publish, change versions, or take on the unrelated Bybit mapping defect. A formal release still requires explicit authorization, a new version/tag, and `RELEASE.md`.

If the next request is to validate this slice, first run a manual packaged-Windows click-through of main/chart coexistence, live exact-source history, zoom/pan/reset, and chart close-to-hide behavior. If the next request is to release it, obtain explicit authorization, choose a new SemVer version, and follow `docs/RELEASE.md`; never reuse or move an existing tag.

## New Thread Bootstrap

1. Read `AGENTS.md`, `docs/INDEX.md`, and this file; then run `git status --short --branch` and compare it with the exact snapshot above.
2. Preserve the complete dirty diff. Chart, corrected zoom, crosshair, and paced prefetch are implemented and verified but uncommitted; the newest test installer path is recorded above.
3. Complete the explicitly authorized source push if it remains pending, using actual Git state to avoid repeating a completed push. Do not independently pick a TODO, discard changes, change versions, tag, publish, install, or release.
4. Once work is authorized, read only the directly relevant decisions/domain docs and source files, then run the smallest relevant baseline verification before changing code.
