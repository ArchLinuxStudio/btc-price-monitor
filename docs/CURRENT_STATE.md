# Current Development State

Checkpoint date: 2026-09-01 (Asia/Shanghai)

## Current Objective

Repair the unattended licensed-DMG mount failure exposed by the immutable `v1.6.1` tag, advance all version sources to `1.6.2`, and publish a successful five-asset `v1.6.2` release without moving or overwriting either failed tag.

## Current Status

- Branch/upstream: `main` tracking `origin/main`.
- The user explicitly authorized committing, building, pushing, tagging, and publishing the next release. `main` and `origin/main` now both point to recovery commit `c3e42a3500a7cebcc83268cbd63e1fe269b3c168`.
- The task started from `main` synchronized with `origin/main` at `cd9a3ca9e189fbc7c9e68eb35cd5296725f48c55`.
- The earlier compact About/resize and filtered-removal commits plus `2bb92ad` containing the uncapped watchlist, screen-bounded height, six-character typography, quote ordering, ES2025/macOS 12 baseline, tests, workflow gate, and documentation have all been pushed to `main`.
- Immutable annotated tag `v1.6.0` points to `2bb92ad`. Its workflow run `33448938555` failed before publication: Linux succeeded; Windows exposed an LF-only static-test regex under CRLF checkout; both macOS bundles built, but Tauri cleaned their temporary `.app` directories before the post-build gate looked there. The dependent Release job was skipped, so no `v1.6.0` Release/assets were published.
- Immutable annotated tag `v1.6.1` points to `c3e42a3`. Its workflow run `33467295096` proved the Windows CRLF repair and completed both macOS bundle builds, but both final-DMG gates stopped at `hdiutil: attach canceled`: `bundle.licenseFile` embeds a license agreement, and unattended mounting requires explicit acceptance on standard input. No `v1.6.1` Release/assets were published.
- Repository rules prohibit moving either public failed tag. All six source/lock/config version fields are now synchronized at `1.6.2`; the working tree contains only the licensed-DMG mount repair, regression/runbook changes, version bump, and updated handoff state.
- The root shared TypeScript config now fixes `target` and ECMAScript library declarations at `ES2025`; `module: ES2022` remains unchanged for browser-native modules. The Tauri macOS overlay now sets `minimumSystemVersion: 12.0`, which Tauri uses for bundle metadata and the macOS deployment target.
- The repaired workflow disables interactive paging and pipes a single `Y` response into each read-only final-DMG mount, then verifies the shipped app's `LSMinimumSystemVersion` and Mach-O deployment target are both exactly 12.0; either mismatch fails its build job and prevents publication. Static coverage also normalizes the inspected source to CRLF so Windows checkout behavior remains tested locally.
- Fresh `1.6.2` dependency, TypeScript, test, frontend, Rust, workflow-YAML, Windows package, package-inspection, and isolated executable-smoke verification passes. The rebuilt installer was inspected but not run or installed.
- The installed per-user `1.4.0` binary predates this redesign and is not a source of truth.

## Completed

- Reduced the fixed About window from `380×450px` to `320×280px` and replaced the disclosure-heavy layout with compact identity and license cards.
- Removed the visible full repository address and complete GPL disclosure from About while retaining the `GPL-3.0-only` summary and warranty notice.
- Added a local GitHub icon button backed by Tauri's opener plugin. A dedicated `about` capability permits only `https://github.com/ArchLinuxStudio/btc-price-monitor`; no wildcard/default URL permission or new CSP origin was added.
- Kept the complete root `LICENSE`, generated `dist/LICENSE.txt`, package metadata, and `bundle.licenseFile` delivery intact.
- Updated static regression coverage and the stable About architecture/decision documentation for the revised user requirement.
- Added a seven-pixel bottom resize handle for quote views with five or more products. Pointer capture supports drag outside the narrow WebView, arrow keys resize by one row, and a mouse fallback remains for engines without Pointer Events.
- Added a single-flight/latest-value resize request path so fast movement cannot accumulate stale native calls. Scrolling, focusability, and its accessible label now follow real `scrollHeight > clientHeight` overflow rather than product count alone.
- Removed the `MAX_PRODUCTS` persistence/UI limit. Every valid supported selection is retained, search additions never become disabled because of list length, and the market feed receives every selected product.
- Removed the frontend eight-row saturation and the main window's static `290px` `maxHeight`. The main-window-only `resize_monitor_height` command now fixes width at `208px` and clamps requested height between the automatic four-row minimum and the lesser of full content height and the space to the current monitor work-area bottom. Management remains capped at `170px`; no general set-size/native-resize permission was granted and `resizable` remains false.
- Added regression coverage for 64 persisted custom products, more-than-eight live subscription IDs, nine-row growth, screen-height clamping, overflow-safe content arithmetic, and the absence of a static main `maxHeight`.
- Amended the compact-layout, watchlist, and native-sizing decisions plus architecture/README/agent constraints for the clarified screen-height requirement.
- Corrected the quote-symbol typography threshold so six-character symbols keep the standard `9px` label size; only symbols longer than six characters receive the compact long-symbol class, while the existing extra-long fallback remains unchanged.
- Added delegated HTML5 drag/drop ordering to every main quote row. Target midpoint selects before/after placement, edge dragging scrolls long lists, transient source/drop classes are cleared on drop/cancel/rebuild/blur/hide/manager-open, and page-level guards prevent external drops from navigating the WebView.
- Added `Alt+ArrowUp/Down` ordering, focus restoration, ordered-list semantics, position-aware accessible labels, instructions, and polite live announcements without taking ordinary Arrow-key scrolling away from the quote list.
- Changed persistence so complete valid lists retain explicit BTC/ETH positions; `fixed` continues to mean non-removable, while incomplete/damaged arrays safely recover canonical BTC/ETH before custom products. A pure reorder helper covers fixed/custom before/after moves, no-ops, immutability, and storage reload.
- Kept display-only ordering out of `PriceFeed.setProducts`, so reordering does not restart WebSockets or UTC-open work. Removal focus now derives its index from removable items rather than assuming BTC/ETH occupy the first two rows.
- Set `dragDropEnabled: false` only on the main Tauri window, as required for frontend HTML5 drag/drop on Windows; title-bar window dragging and the native-clamped bottom height handle remain separate.
- Reproduced the removal bug specifically with a non-empty search: an already selected product was rendered as a disabled `✓` search result even though clearing the search exposed a working `×` removal button. The persistence/filter path itself was correct.
- Changed selected search results to reuse the normal selected-product row. Custom products expose the same accessible `×` removal action in filtered and unfiltered management views; fixed BTC/ETH remain non-removable, and unselected results remain addable regardless of selected count.
- Added regression coverage for the selected-search rendering branch and for saving, filtering, and reloading a removed custom product.
- Synchronized all six version sources at `1.6.0`, ran the release verification commands, and built and inspected the local Windows x64 NSIS test installer without running it.
- Raised the shared TypeScript language and library target from `ES2019` to the pinned compiler's newest concrete standard, `ES2025`, while retaining `ES2022` native-module output rather than adopting floating `ESNext`.
- Raised Tauri's declared macOS minimum from 10.15 to 12.0. Added a regression for both baselines and synchronized architecture, decision, user-facing, release, known-issue, and handoff documentation.
- Confirmed through the failed tag run that `release.needs: build` prevents publication when any platform job fails; no partial `v1.6.0` Release was created.
- Made the source-inspection regression explicitly exercise CRLF text as well as LF. Replaced the temporary-app macOS gate with a read-only mount of the final DMG, status-preserving detach cleanup, and an all-slices deployment-target check.
- Documented immutable failed-tag recovery, final-DMG validation, and cross-platform newline requirements in the release runbook.
- Diagnosed `v1.6.1` directly from the completed macOS job logs: Tauri produced/uploaded each DMG, then `hdiutil attach` canceled before any plist or Mach-O read because the image carries the configured license agreement. Added a single `Y` response on the command's standard input and locked the noninteractive acceptance path with a static regression.

## In Progress

Formal `v1.6.2` recovery is active. The licensed-DMG mount cause is patched and the complete local verification/package pass is successful. Remaining work is final diff review, commit/push, a new immutable tag, successful four-runner gates, five-asset verification, and a post-release handoff checkpoint.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `src-tauri/src/lib.rs` | Tray action routing, main/About show-hide behavior, tray-only exit, monitor sizing, opener plugin initialization |
| `src-tauri/tauri.conf.json` | Main/About window envelopes, main HTML5 drag/drop compatibility, capability selection, version, CSP, bundle license |
| `src/index.html` / `src/styles.css` / `src/main.ts` | Sortable quote/manager UI, accessibility, overflow scrolling, resize handle/input coalescing, and native layout calls |
| `src/about.html` / `src/about.css` / `src/about.ts` | Compact About content, styling, accessible GitHub button, and opener interaction |
| `scripts/frontend.ts` | Clean frontend emit, static/license copying, and authoritative version injection |
| `tsconfig.json` / `tsconfig.app.json` / `tsconfig.test.json` / `tsconfig.build.json` | Shared ES2025 language/library baseline, native ES2022 module contract, and inherited app/test/build boundaries |
| `src-tauri/tauri.macos.conf.json` | macOS app/dmg targets and the 12.0 minimum system/deployment baseline |
| `src-tauri/capabilities/main.json` / `about.json` | Isolated main-window commands and exact repository URL permission |
| `src-tauri/build.rs` / `src-tauri/permissions/window-controls.toml` | Narrow custom-command manifest and main-window command allowlist |
| `LICENSE` | Complete GNU GPL v3 text for the `GPL-3.0-only` grant |
| `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` | Version/license metadata and locked opener dependency |
| `tests/ui.test.ts` / `tests/watchlist.test.ts` / `tests/price-feed.test.ts` / `src-tauri/src/lib.rs` tests | ES/macOS baseline, reorder/persistence contracts, uncapped subscriptions, screen-bounded sizing, fixed width, permission negatives, compact About, native routing, and lifecycle coverage |
| `docs/DECISIONS.md` | Stable ES/macOS compatibility, compact-layout, native-sizing, GPL/About choices, and rejected alternatives |
| `docs/RELEASE.md` | Packaging/release procedure, macOS 12 metadata checks, and safe installer-license verification |
| `.github/workflows/build-desktop.yml` | Four-platform build matrix, macOS 12 metadata gate, and tag-driven five-asset publication |

## Current Implementation

Tauri pre-creates `main` and hidden `about` windows from `tauri.conf.json`. Stable tray item IDs map to show main, hide main, show About, or quit. Showing About centers, reveals, and focuses the existing window; close requests for either managed window are prevented and converted to hide.

The About page uses one local ES module. During each clean frontend build, `scripts/frontend.ts` reads the authoritative Tauri version, replaces its template token, and copies the canonical icon plus a standalone complete `LICENSE.txt` into ignored `dist/`. The UI shows only a concise GPL/SPDX/warranty summary.

The GitHub icon invokes `window.__TAURI__.opener.openUrl` with one fixed repository URL. About has its own capability containing only `opener:allow-open-url` for that exact URL; it does not receive the main commands, default URL protocols, wildcard scope, or a new CSP network origin. Tauri still embeds the complete root license in applicable bundles.

The main window remains `resizable: false` with `minWidth = maxWidth = 208`, but it has no static `maxHeight`. Five or more selected products reveal a small bottom handle. Pointer movement sends the complete row count and requested logical height through the custom command; Rust computes `26 + 33 × rows` with saturating arithmetic, bounds it by the space from the window's current top to the current monitor work-area bottom, and calls `set_size` with the fixed width. Nine or more rows therefore no longer stop at `290px`; if selected content exceeds the usable screen height, the quote list keeps scrolling. Opening management hides the handle and temporarily applies its count-derived height up to `170px`; closing restores the remembered quote height, clamped again if products or the available work area changed. Height is session-only and returns to automatic sizing after process restart.

Resize requests are requestAnimationFrame-coalesced with at most one resize IPC in flight; the newest pending height replaces older movement. Pointer capture makes growth/shrink robust when the cursor leaves the 208px content area. Native window behavior is not reasserted on every drag frame; its existing focus/resume/10-second resilience layers remain.

Watchlist normalization preserves explicit order when canonical BTC/ETH are both present, validates and deduplicates every product, and no longer truncates by count. If either fixed default is missing, both canonical defaults are restored before the remaining valid custom products. BTC/ETH cannot be deleted but can be reordered.

The quote list uses one delegated drag event surface rather than per-row listeners. A successful drop or keyboard move runs the pure reorder helper, saves only when the ID sequence actually changed, rebuilds rows while restoring scroll/focus, and announces the new position. It deliberately does not call `feed.setProducts`; quotes and sources are keyed by product ID, so a display-only move requires no subscription rebuild. Tauri native file-drop interception is disabled for `main` only, and external page drops are cancelled.

All application, test/tooling, and clean-build TypeScript configurations inherit a fixed `ES2025` target and library surface from the root config. The emitted files remain unbundled native `ES2022` modules. The macOS overlay declares 12.0 as the minimum system version; Tauri propagates that value into application metadata and its deployment target. Neither TypeScript nor Tauri polyfills browser APIs, so the newer compiler baseline is not evidence that every API admitted by `lib: ES2025` exists in macOS 12 WKWebView, Linux WebKitGTK, or the Node 20 tooling runtime.

The established real-USD crypto spot and explicitly labeled stock-related USDT perpetual implementation is otherwise unchanged. [`MARKET_DATA.md`](MARKET_DATA.md) remains authoritative for provider and UTC-day semantics.

## Current Problems

- No known blocking product bug and no known flaky test.
- A real macOS bundle was not produced on this Windows host, so `LSMinimumSystemVersion = 12.0`, Mach-O `minos 12.0`, startup on macOS 12.x, and the current ES2025 output in that system WKWebView remain unverified. Linux WebKitGTK compatibility with future ES2025-era syntax/APIs likewise requires review.
- Keyboard ordering and persistence were exercised in the local browser, but its coordinate-drag automation did not synthesize a native HTML5 drag. Real mouse drag ordering in a Windows Tauri WebView, long-list edge scrolling, and macOS/Linux behavior remain runtime-verification gaps.
- The former eight-row resize behavior had a real Windows smoke test, but the new beyond-eight/work-area clamp has automated coverage only; real Windows, macOS, and Linux runtime verification of the clarified behavior remains outstanding.
- Real compact-About and repository-opener verification remains incomplete on macOS and Linux/Wayland.
- Local artifacts are unsigned; macOS signing/notarization is not configured.
- The installed per-user binary on this machine is not authoritative for final HEAD. A prior NSIS UI-automation check advanced past the license page and installed a near-final same-version build before cancellation; do not repeat interactive installation merely to inspect the license page. See [`RELEASE.md`](RELEASE.md).
- Remaining limitations and technical debt are maintained in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); executable but unauthorized backlog items are in [`TODO.md`](TODO.md).

## Verification State

Verified on Windows, 2026-09-01, against the current uncommitted `v1.6.2` licensed-DMG recovery worktree:

- `npm.cmd ci`: passed; nine audited packages and zero reported vulnerabilities.
- `npm.cmd run check`: passed after the final pager-safe mount change; strict application/test TypeScript checks, 75/75 Node tests, and clean ES2025 frontend emit.
- `NODE_USE_SYSTEM_CA=1 npx.cmd --yes yaml-lint .github\workflows\build-desktop.yml`: passed after the final workflow change. The system-CA override was process-local.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 6/6 Rust tests; only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed. The fresh unsigned release executable is 3,300,352 bytes with SHA-256 `017E3A099C6EDE6F9B0A9C62597BBC6F2EDD9F07F0207F507360A35084FE77A6`; the fresh unsigned `Crypto Top_1.6.2_x64-setup.exe` is 1,210,329 bytes with SHA-256 `BAB0F1C23B54044A24517E5032F033EE32E2D9C623653617BB57F3CE6B3A6165`. Both report file/product version `1.6.2`; the installer was not run or installed.
- The exact release executable remained alive with a nonzero native window handle during an isolated five-second startup smoke. Only that launched PID was stopped; its dedicated WebView data directory was removed, and no pre-existing application process was touched.
- Generated `dist/about.html` contains `1.6.2` with no unresolved version token. `dist/LICENSE.txt` is byte-identical to root `LICENSE` at SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`; the 35,152-byte NSIS `license_file` contains the GPL header and generated `installer.nsi` has a non-empty `!define LICENSE`.
- The pager-safe licensed-DMG mount cannot run on this Windows host; both GitHub macOS jobs must still prove the final-DMG metadata path before publication.

Verified on Windows, 2026-09-01, against the exact committed/tagged `v1.6.1` recovery candidate at `c3e42a3` before the licensed-DMG mount fix:

- `npm.cmd ci`: passed; nine audited packages and zero reported vulnerabilities.
- `npm.cmd run check`: passed; strict application/test TypeScript checks, 75/75 Node tests (including an explicit CRLF source copy), and clean ES2025 frontend emit.
- `NODE_USE_SYSTEM_CA=1 npx.cmd --yes yaml-lint .github\workflows\build-desktop.yml`: passed. The system-CA override was process-local.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 6/6 Rust tests; only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed. The fresh unsigned release executable is 3,300,352 bytes with SHA-256 `DC731F354FB6089F4D2AD4D4791CC4567A9B2C794F3D5487AE7E32C7534A1EB8`; the fresh unsigned `Crypto Top_1.6.1_x64-setup.exe` is 1,210,280 bytes with SHA-256 `E4F6BBABC66B5C7C3D25EF4A39C8A53488A38CC619210AD3F7940850ED86A158`. Both report file/product version `1.6.1`; the installer was not run or installed.
- The exact release executable remained alive with a nonzero native window handle during an isolated five-second startup smoke. Only that launched PID was stopped; its dedicated WebView data directory was removed, and no pre-existing application process was touched.
- Generated `dist/about.html` contains `1.6.1` with no unresolved version token. `dist/LICENSE.txt` is byte-identical to root `LICENSE` at SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`; the 35,152-byte NSIS `license_file` contains the GPL header and generated `installer.nsi` has a non-empty `!define LICENSE`.
- macOS final-DMG validation cannot run on this Windows host; the repaired gate still requires its first real proof from both GitHub macOS jobs before publication.
- GitHub Actions run `33467295096`: the Windows CRLF regression stayed fixed and both macOS architectures built/uploaded their DMGs, but their metadata steps failed immediately with `hdiutil: attach canceled`. The images embed the configured bundle license, so noninteractive inspection requires an affirmative response on standard input; no plist/Mach-O mismatch was reported and no Release was published.

Verified on Windows, 2026-09-01, against the exact committed/tagged `v1.6.0` candidate at `2bb92ad` before the release-only fixes:

- `npm.cmd ci`: passed; nine audited packages and zero reported vulnerabilities.
- `node --import=tsx --test tests/ui.test.ts`: passed, 6/6 focused tests, including the `ES2025`/macOS 12.0 configuration regression and tag-build metadata gate.
- `npm.cmd run check`: passed; strict application/test TypeScript checks, 75/75 Node tests, and clean ES2025 frontend emit. Generated native modules retain modern optional chaining instead of the prior ES2019 downlevel output.
- `NODE_USE_SYSTEM_CA=1 npx.cmd --yes yaml-lint .github\workflows\build-desktop.yml`: passed. The system-CA override was process-local and only needed because the Node CLI otherwise encountered the already documented local certificate-chain issue.
- The persistence regression keeps 64 custom entries plus fixed BTC/ETH, and the feed regression sends 16 selected product IDs without truncation.
- The UI regression locks the compact-symbol threshold at more than six characters, preventing six-character labels from receiving the smaller-font class again.
- Reorder regressions cover fixed/custom moves to both sides of a target, input immutability, already-positioned/unknown-ID no-ops, stored-order reload, incomplete fixed-default recovery, delegated drag lifecycle wiring, insertion/focus styles, keyboard/live-region contracts, external-drop prevention, no reorder-time feed reset, and main-window `dragDropEnabled: false`.
- Local browser interaction loaded seven live quote rows, moved BTC from position 1 to 2 with `Alt+ArrowDown`, retained focus and announced the new position, reloaded with the same persisted order, then restored/reloaded the original order. The temporary viewport override, tab, and HTTP server were removed.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 6/6 Rust tests. Sizing coverage includes five/eight/nine rows, screen-limited long lists, saturating content-height arithmetic, window position, and display scaling; only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed. The fresh ignored unsigned release executable is 3,300,352 bytes with SHA-256 `B99219861179F9F6D21CB276FF4EECF41FED0C54FC9609BE1EB4EEFC3D329298`; the fresh ignored unsigned `Crypto Top_1.6.0_x64-setup.exe` is 1,209,825 bytes with SHA-256 `02A5369485776DB7CED7254E0A037D2E4ACF7F8EACA8951AE8719F1F1AA366E0`. The installer was not run or installed.
- The release executable reports file/product version `1.6.0` and remained alive with a native window handle during an isolated five-second startup smoke. Only that launched PID was terminated; its dedicated WebView test-data directory was removed, and no pre-existing application process was touched.
- Generated `dist/about.html` contains `1.6.0` with no unresolved version token and `dist/LICENSE.txt` is byte-identical to root `LICENSE` at SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`. The generated 35,152-byte NSIS `license_file` contains the GPL header and `installer.nsi` has a non-empty `!define LICENSE`.
- `git diff --check`: passed with only the expected Windows LF-to-CRLF notices.
- GitHub Actions run `33448938555`: failed without publishing a Release. Linux x64 completed successfully. Windows stopped in the static UI suite because the `reorderSelectedProduct` extractor required LF-only blank lines on a CRLF checkout. Both macOS architectures completed DMG construction and artifact upload, then the metadata gate found zero temporary `.app` directories because Tauri's DMG builder had already cleaned them. `Publish release assets` was skipped.
- Reproduction after log inspection: all 75 tests, both TypeScript checks, and frontend emit passed under an explicit local Node 20.20.2 runtime, confirming the Windows failure was newline-dependent rather than an ES2025/Node 20 runtime failure.
- Not verified for this worktree: macOS 12 bundle/deployment metadata and runtime compatibility, representative Linux WebKitGTK compatibility with the higher language target, real Tauri mouse row dragging/edge scrolling, a real native height drag beyond eight rows, switching monitors with different scaling/work areas, or installation.

Previously verified on Windows, 2026-08-31, against the exact committed `1.5.1` search-state removal patch:

- `node --import=tsx --test tests/watchlist.test.ts tests/ui.test.ts`: passed, 24/24 focused tests.
- `npm.cmd run check`: passed; strict application/test TypeScript checks, 70/70 Node tests, and clean ES2019 frontend emit.
- Local browser reproduction before the fix showed selected `ADA` as a disabled `✓` result with no delete action while the query remained active. After rebuilding, the same filtered view exposed a visible, enabled `删除 ADA` button; no BTC/ETH delete button existed. The temporary test tab/server were closed.
- The persistence regression confirms that filtering a custom product out, saving, and reloading leaves only the fixed defaults.
- `npm.cmd ci`: passed; nine audited packages, zero reported vulnerabilities.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 5/5 Rust tests; only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed without running the installer. The ignored unsigned release executable is 3,298,304 bytes, SHA-256 `80198FC5C757CD45FE6FFC9EBC837503E9158E83B16B867C82A3B35C042C67F8`. The ignored `Crypto Top_1.5.1_x64-setup.exe` NSIS installer is 1,209,130 bytes, SHA-256 `4FEE73C687C576AC49775E4DCFA218BBE1F496FB5DD9BD869FF78D9A9EDC1DC2`.
- Generated `dist/about.html` contains version `1.5.1` with no unresolved version token. `dist/LICENSE.txt` remains byte-identical to root `LICENSE`, both with SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`.
- Generated NSIS `license_file` contains the GPL header and `installer.nsi` has a non-empty `!define LICENSE`. The installer was not run.
- `git diff --check`: passed with only the expected Windows LF-to-CRLF notices.

Previously verified on Windows, 2026-08-31, against the exact committed `1.5.0` compact About and former eight-row-bounded resize source:

- `npm.cmd ci`: passed; lockfile dependencies installed cleanly.
- `npm.cmd run check`: passed; strict application/test TypeScript checks, 69/69 Node tests, and clean ES2019 frontend emit.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 5/5 Rust tests; quote automatic/content clamps and the unchanged `170px` management cap are covered. Only the documented benign MSVC import-library message appeared.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed without running the installer. The ignored unsigned release executable is 3,298,304 bytes, SHA-256 `7E931A8F245914303BF74C49F42B43776F1167810E18C1E6B18B769CD2C0AC1C`. The ignored `Crypto Top_1.5.0_x64-setup.exe` NSIS installer is 1,208,942 bytes, SHA-256 `0E83EA901186418950CC0883A889D72886EEBF909C8E52D099E1A0023BA0B068`.
- Browser visual QA used exact `208×158`, `208×191`, `208×290`, and `208×170` viewports with five/eight products. It confirmed four-row overflow, five/eight-row complete display without a false scroll label, a contained bottom handle, and the compact capped management layout.
- A real Windows Tauri debug-window smoke started from a separate two-row test state, added six products through the native WebView, and verified: pointer-captured growth outside the narrow window from `208×158` to the clamped `208×290`; management at `208×170`; quote-height restoration to `208×290`; keyboard steps to `208×257` and back; and pointer shrink clamped to `208×158`. Width stayed `208px` throughout. The test process/config were removed, the pre-existing application process was not touched, and reopening the test binary confirmed the original two-row `208×92` state rather than a retained test watchlist.
- Generated `dist/about.html` has version `1.5.0`, no unresolved token, no visible complete repository address, and no GPL-full-text container. `dist/LICENSE.txt` remains byte-identical to root `LICENSE` with SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`.
- Browser visual QA at an exact `320×280` viewport confirmed no overflow, the compact two-card layout, visible keyboard focus, and a contained opener-failure message.
- Native release-binary smoke identified the exact test process/tray menu, opened an About WebView with a `320×280` content area, confirmed the concise visible/accessibility content, and clicked the GitHub button. The system default browser loaded `github.com/ArchLinuxStudio/btc-price-monitor`. The test process then exited through its own tray Quit action with no application/WebView process left behind.
- Generated NSIS `license_file` still contains the GPL header and `installer.nsi` has a non-empty `!define LICENSE`. The installer was not run.
- `git diff --check` passed with only the expected Windows LF-to-CRLF notices. A read-only pre-commit audit found no credentials, temporary files, generated artifacts, unrelated changes, or missing required source files.

Not verified: macOS 12 packaging/startup and actual system-WebView execution of the current output, representative Linux WebKitGTK compatibility with the higher target, real native quote-row mouse dragging and beyond-eight/work-area height dragging, real macOS/Linux compact About/opener/resize behavior, signing, notarization, or a five-asset formal release containing the current changes. There is no standalone lint command; TypeScript checking is part of `npm.cmd run check`, and Rust linting is the Clippy command above.

## Next Recommended Action

1. Complete the final diff/credential/version review, commit and push the recovery, then create immutable annotated tag `v1.6.2` without rerunning or moving `v1.6.0`/`v1.6.1`.
2. Wait for every build and release job rather than reporting success early.
3. Verify the resulting `v1.6.2` Release has exactly the five named assets, valid downloads/digests, readable release text, and successful licensed-final-DMG macOS 12.0 gates. Record the remaining lack of a real macOS 12 runtime smoke honestly.

## New Thread Bootstrap

1. Read `AGENTS.md`, `docs/INDEX.md`, and this file.
2. Run `git status --short --branch`. At this checkpoint `main` and `origin/main` are at `c3e42a3`; public failed tags `v1.6.0` and `v1.6.1` must not move, and the unstaged recovery files are the intentional `1.6.2` work.
3. Inspect `tsconfig.json`, `src-tauri/tauri.macos.conf.json`, the corresponding UI regression, and the compatibility decision before changing language/runtime support. For quote UI work, inspect `normalizeWatchlist`/`reorderWatchlist`, delegated quote events, reorder styles/ARIA, native size clamps, and their focused tests.
4. Continue from `Next Recommended Action`; formal `v1.6.2` recovery commit/build/push/tag/Release publication is explicitly authorized. Installer execution/installation, moving either failed tag, and unrelated product changes remain out of scope.
