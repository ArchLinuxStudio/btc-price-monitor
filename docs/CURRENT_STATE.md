# Current Development State

Checkpoint date: 2026-08-31 (Asia/Shanghai)

## Current Objective

Prepare the completed watchlist search-state deletion fix as patch version `1.5.1`, run release-grade local verification, commit the source, and build a new unsigned Windows NSIS Release package without publishing or installing it.

## Current Status

- Branch/upstream: `main` tracking `origin/main`.
- The task started from `main` synchronized with `origin/main` at `cd9a3ca9e189fbc7c9e68eb35cd5296725f48c55`.
- The completed compact About redesign/exact repository opener, bounded quote-height resizing, version bump, tests, and preserved handoff-document changes are included in one authorized local `1.5.0` commit. After that commit, `main` is one commit ahead of `origin/main`; it has not been pushed.
- The watchlist search-state deletion fix, regression coverage, synchronized `1.5.1` version, and this final package record are included in a second authorized local commit. After that commit, `main` is two commits ahead of `origin/main`; neither commit has been pushed.
- All six source/lock/config version fields are synchronized at `1.5.1`.
- The user authorized committing the bugfix/version work and building a new local Release package. Push, tag, GitHub Release publication, installer execution, and installation remain unauthorized.
- Full source verification and unsigned Windows NSIS packaging against exact version `1.5.1` are complete; no implementation blocker is known. Generated `dist/` and `src-tauri/target/` outputs remain ignored. The earlier local `1.5.0` package is historical and is superseded for current source.
- The installed per-user `1.4.0` binary predates this redesign and is not a source of truth.

## Completed

- Reduced the fixed About window from `380×450px` to `320×280px` and replaced the disclosure-heavy layout with compact identity and license cards.
- Removed the visible full repository address and complete GPL disclosure from About while retaining the `GPL-3.0-only` summary and warranty notice.
- Added a local GitHub icon button backed by Tauri's opener plugin. A dedicated `about` capability permits only `https://github.com/ArchLinuxStudio/btc-price-monitor`; no wildcard/default URL permission or new CSP origin was added.
- Kept the complete root `LICENSE`, generated `dist/LICENSE.txt`, package metadata, and `bundle.licenseFile` delivery intact.
- Updated static regression coverage and the stable About architecture/decision documentation for the revised user requirement.
- Added a seven-pixel bottom resize handle only for quote views with five to eight products. Pointer capture supports drag outside the narrow WebView, arrow keys resize by one row, and a mouse fallback remains for engines without Pointer Events.
- Added a single-flight/latest-value resize request path so fast movement cannot accumulate stale native calls. Scrolling, focusability, and its accessible label now follow real `scrollHeight > clientHeight` overflow rather than product count alone.
- Added a main-window-only `resize_monitor_height` command. Rust fixes width at `208px`, clamps requested height between the automatic four-row minimum and current content, keeps the session quote height across management mode, and leaves management at its existing `170px` maximum. No general set-size/native-resize permission was granted and `resizable` remains false.
- Amended the compact-layout and native-sizing decisions plus architecture/README/agent constraints for the explicit bounded-resize requirement.
- Reproduced the removal bug specifically with a non-empty search: an already selected product was rendered as a disabled `✓` search result even though clearing the search exposed a working `×` removal button. The persistence/filter path itself was correct.
- Changed selected search results to reuse the normal selected-product row. Custom products now expose the same accessible `×` removal action in both filtered and unfiltered management views; fixed BTC/ETH remain non-removable, and unselected results remain disabled when the eight-product cap is full.
- Added regression coverage for the selected-search rendering branch and for saving, filtering, and reloading a removed custom product.

## In Progress

None. The deletion fix, synchronized `1.5.1` patch version, release-grade verification, local source commit, and unsigned Windows Release package are complete.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `src-tauri/src/lib.rs` | Tray action routing, main/About show-hide behavior, tray-only exit, monitor sizing, opener plugin initialization |
| `src-tauri/tauri.conf.json` | Main and compact About window envelopes, capability selection, version, CSP, bundle license |
| `src/index.html` / `src/styles.css` / `src/main.ts` | Quote/manager UI, overflow-aware scrolling, resize handle/input coalescing, and native layout calls |
| `src/about.html` / `src/about.css` / `src/about.ts` | Compact About content, styling, accessible GitHub button, and opener interaction |
| `scripts/frontend.ts` | Clean frontend emit, static/license copying, and authoritative version injection |
| `src-tauri/capabilities/main.json` / `about.json` | Isolated main-window commands and exact repository URL permission |
| `src-tauri/build.rs` / `src-tauri/permissions/window-controls.toml` | Narrow custom-command manifest and main-window command allowlist |
| `LICENSE` | Complete GNU GPL v3 text for the `GPL-3.0-only` grant |
| `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` | Version/license metadata and locked opener dependency |
| `tests/ui.test.ts` / `tests/watchlist.test.ts` / `src-tauri/src/lib.rs` tests | Search-state deletion/persistence, bounded sizing, fixed width, permission negatives, compact About, native routing, and lifecycle coverage |
| `docs/DECISIONS.md` | Stable compact-layout, native-sizing, GPL/About choices, and rejected alternatives |
| `docs/RELEASE.md` | Packaging/release procedure and safe installer-license verification |

## Current Implementation

Tauri pre-creates `main` and hidden `about` windows from `tauri.conf.json`. Stable tray item IDs map to show main, hide main, show About, or quit. Showing About centers, reveals, and focuses the existing window; close requests for either managed window are prevented and converted to hide.

The About page uses one local ES module. During each clean frontend build, `scripts/frontend.ts` reads the authoritative Tauri version, replaces its template token, and copies the canonical icon plus a standalone complete `LICENSE.txt` into ignored `dist/`. The UI shows only a concise GPL/SPDX/warranty summary.

The GitHub icon invokes `window.__TAURI__.opener.openUrl` with one fixed repository URL. About has its own capability containing only `opener:allow-open-url` for that exact URL; it does not receive the main commands, default URL protocols, wildcard scope, or a new CSP network origin. Tauri still embeds the complete root license in applicable bundles.

The main window remains `resizable: false` with `minWidth = maxWidth = 208`. Five to eight selected products reveal a small bottom handle. Pointer movement sends only a row count and requested logical height through the custom command; Rust clamps it to `quote_auto_height(row_count)..=quote_content_height(row_count)` and calls `set_size` with the fixed width. The maximum Tauri envelope is `290px`, exactly eight quote rows plus chrome. Opening management hides the handle and temporarily applies its count-derived height up to `170px`; closing restores the remembered quote height, clamped again if products changed. Height is session-only and returns to automatic sizing after process restart.

Resize requests are requestAnimationFrame-coalesced with at most one resize IPC in flight; the newest pending height replaces older movement. Pointer capture makes growth/shrink robust when the cursor leaves the 208px content area. Native window behavior is not reasserted on every drag frame; its existing focus/resume/10-second resilience layers remain.

The established real-USD crypto spot and explicitly labeled stock-related USDT perpetual implementation is unchanged. [`MARKET_DATA.md`](MARKET_DATA.md) remains authoritative for provider and UTC-day semantics.

## Current Problems

- No known blocking product bug and no known flaky test.
- Real bounded-resize runtime verification is complete on Windows; macOS/Linux pointer/window-manager behavior remains unverified.
- Real compact-About and repository-opener verification remains incomplete on macOS and Linux/Wayland.
- Local artifacts are unsigned; macOS signing/notarization is not configured.
- The installed per-user binary on this machine is not authoritative for final HEAD. A prior NSIS UI-automation check advanced past the license page and installed a near-final same-version build before cancellation; do not repeat interactive installation merely to inspect the license page. See [`RELEASE.md`](RELEASE.md).
- Remaining limitations and technical debt are maintained in [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); executable but unauthorized backlog items are in [`TODO.md`](TODO.md).

## Verification State

Verified on Windows, 2026-08-31, against the exact synchronized `1.5.1` search-state removal patch:

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

Verified on Windows, 2026-08-31, against the exact synchronized `1.5.0` compact About and bounded-resize source:

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

Not verified: real macOS/Linux compact About/opener/resize behavior, signing, notarization, or a five-asset `v1.5.1` formal release. There is no standalone lint command; TypeScript checking is part of `npm.cmd run check`, and Rust linting is the Clippy command above.

## Next Recommended Action

1. Preserve both local commits and the ignored `Crypto Top_1.5.1_x64-setup.exe` package. Do not push, tag, publish a GitHub Release, or run the installer without explicit authorization.
2. If watchlist removal changes again, keep BTC/ETH fixed, allow every custom selected product to be removed in filtered and unfiltered manager views even when the list is full, persist the removal, and rebuild the feed without the removed product.
3. Real macOS/Linux resize and About/opener smoke remain release-candidate tasks. A future formal release requires explicit authorization and the complete procedure in [`RELEASE.md`](RELEASE.md).

## New Thread Bootstrap

1. Read `AGENTS.md`, `docs/INDEX.md`, and this file.
2. Run `git status --short --branch`. Immediately after this checkpoint, the worktree should be clean and `main` should be two local commits ahead of `origin/main`; investigate before changing anything if that is not true.
3. For the active deletion fix inspect `renderSelectedProduct`, `renderSearchProduct`, and `removeProduct` in `src/main.ts`, plus the focused UI/persistence tests. The confirmed root cause was the selected result's old disabled search-only presentation, not `saveWatchlist`.
4. Continue from `Next Recommended Action`; no push, tag, Release publication, installer execution, new implementation, or general resize permission is authorized.
