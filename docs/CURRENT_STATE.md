# Current Development State

Checkpoint date: 2026-08-29 (Asia/Shanghai)

## Current Objective

Publish `v1.3.0` containing the completed multi-product/four-source feature set and strict TypeScript migration. The migration keeps features, UI, runtime contracts, market semantics, and Rust source unchanged; the release changes only required package/Cargo/Tauri version metadata.

## Current Status

- Branch/upstream: `main` tracking `origin/main`; the completed TypeScript migration is currently uncommitted, so live Git is authoritative.
- Most recent product-code commit: `3f68c6d4d2a4f8f50df3f12a2740b760454565b3` (`feat: add compact multi-source crypto watchlist`). The documentation-only checkpoint commit follows it without changing product source/config/tests.
- Product-code baseline described as `v1.2.1-3-g3f68c6d` before the documentation commit. No new tag was created.
- Source version is synchronized to `1.3.0` in package/Cargo/Tauri metadata for the explicitly authorized release.
- Latest published GitHub Release is still `v1.2.1`; it has five platform assets but predates the current watchlist/four-source implementation.
- The TypeScript migration is complete and currently uncommitted on top of `main`; the user explicitly authorized committing, pushing, and publishing release `v1.3.0` on 2026-08-29.
- Live Git currently contains the intentional `.js` → `.ts` renames plus build/config/documentation work. Treat live Git as authoritative if this checkpoint is resumed.

### Documentation checkpoint

- The superseded monolithic `CODEX_CONTEXT.md` was removed after migration.
- `README.md` gained only the developer-document entry links.
- `AGENTS.md` and eight routed documents under `docs/` now provide the persistent development context.
- The user explicitly authorized committing and pushing this documentation-only checkpoint on 2026-08-22.
- No product source/config/test file changed, and no unrelated user modification was included.
- The expected post-push state is a clean `main` synchronized with `origin/main`; always confirm with live `git status --short --branch`.

## Completed

- Default fixed BTC/ETH plus up to six removable Coinbase online real-USD products, with validated local persistence.
- Compact temporary add/search/delete manager without widening the accepted `208px` monitor.
- Four independent live sources: Coinbase, Kraken, Bitstamp, and Bitfinex; Coinbase REST only when every WebSocket is stale/missing.
- Strict same-source UTC+0 calendar-day change, source-specific open acquisition, rollover invalidation, retry/timeout guards, and request concurrency limits.
- Bitstamp exact official USD-SPOT mappings and Bitfinex trade/candle subscription-ACK health checks.
- Tray-only resident behavior, dynamic native height, no taskbar/Dock entry, and no hover text tooltips.
- Cross-platform release workflow configured to use four build runners and publish five Release assets on a new tag; its release job still needs its first production end-to-end run.
- This checkpoint split the former monolithic `CODEX_CONTEXT.md` into `AGENTS.md` and routed `docs/` documents, then committed and pushed that migration with explicit user authorization.
- All four frontend modules and all four Node test files now use strict TypeScript; source imports still emit as native `.js` browser-module specifiers.
- The framework-free build/watch path emits ES2019 modules into ignored `dist/`, copies HTML/CSS byte-for-byte, and makes Tauri consume that output without changing CSP, permissions, window settings, or Rust/Cargo source.
- TypeScript/frontend, Rust, Windows NSIS, and native Windows behavior verification are complete for this migration.

## In Progress

- Formal `v1.3.0` release preparation is active: version sources are synchronized and release-level verification is complete; commit/push/tag operations remain.
- After the tag workflow starts, wait for all platform builds and verify exactly five published assets before declaring the release complete.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `AGENTS.md` | Persistent agent entry, guardrails, and standard commands |
| `docs/INDEX.md` | Selective-reading map and unique authority boundaries |
| `docs/ARCHITECTURE.md` | Stable modules, data flow, models, UI/native/security boundaries |
| `docs/MARKET_DATA.md` | Provider mappings, selection, UTC open, stale/retry/network semantics |
| `docs/DECISIONS.md` | Accepted constraints and rejected alternatives |
| `docs/RELEASE.md` | Versioning, packaging, tag workflow, asset verification |
| `docs/TODO.md` | Remaining authorized-or-future work with completion criteria |
| `docs/KNOWN_ISSUES.md` | Current limitations, technical debt, workarounds, investigation evidence |
| `src/price-feed.ts` | Four-source `PriceFeed`, resilient connections, fallback and UTC state |
| `src/watchlist.ts` | Product/catalog/persistence and exact provider mappings |
| `src/main.ts` | Watchlist UI and render/native-command orchestration |
| `scripts/frontend.ts` | Cross-platform TypeScript emit/watch and unchanged HTML/CSS copying into ignored `dist/` |
| `tsconfig*.json` | Strict application, test/tooling, and browser-emission configurations |
| `src-tauri/src/lib.rs` | Tray/window/always-on-top/dynamic-height behavior |
| `tests/` | 58 TypeScript regression tests across market data, watchlist, formatting, UI/CSP |
| `.github/workflows/build-desktop.yml` | Tag/manual build matrix and Release publishing |

## Current Implementation

The static frontend is authored in TypeScript and emitted by `tsc` as unbundled browser ES modules. The existing HTML/CSS are copied unchanged to ignored `dist/`, which Tauri serves in development and packages in builds. It loads the persisted watchlist, constructs a `PriceFeed`, opens provider sockets, and coalesces state rendering. Coinbase covers every selected product. Kraken and Bitfinex currently have verified BTC/ETH mappings; Bitstamp adds exact intersections from its official enabled USD spot catalog. Selection briefly prefers Coinbase, then the newest healthy WebSocket, then Coinbase REST. Each displayed change uses an open cached for the same provider/product/current UTC day.

Adding/removing products calls `PriceFeed.setProducts`, which rebuilds affected subscriptions, aborts obsolete REST work, and uses revision guards against late writes. Rust owns the window/tray lifecycle and clamps height; the frontend does not receive arbitrary resize permission.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`MARKET_DATA.md`](MARKET_DATA.md) rather than expanding this volatile snapshot.

## Current Problems

- Current main has not been released. The published `v1.2.1` binaries do not contain the newest features.
- The newer automatic Release job has never been exercised end-to-end by a tag created after that job was added.
- Real macOS/Linux runtime smoke coverage, code signing/notarization, and several low-priority quality gaps remain. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).
- No blocker prevents local development or a future versioned release.

## Verification State

Verified on 2026-08-29 against the current uncommitted migration:

- Pre-migration `npm.cmd run check`: passed, 58/58 tests plus syntax checks for the original four JavaScript modules.
- Final `npm.cmd run check` at version `1.3.0`: passed; strict application and test TypeScript checks, 58/58 tests, and a clean ES2019 frontend emit all succeeded.
- Emitted `dist/` contains only the four `.js` modules plus `index.html`/`styles.css`; static-file SHA-256 values match their `src/` originals and browser imports retain `.js` specifiers.
- Development watch mode reached zero errors without deleting the valid prebuilt `dist/main.js`, avoiding a first-load race.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 2/2 Rust tests.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed with Tauri's `beforeBuildCommand`; the local `v1.3.0` NSIS is 1,140,441 bytes with SHA-256 `06F0A1F39FC7A72659625F61505C52698163777530FC54A551E06A6FF55B33BB`. It is unsigned and ignored; release assets must come from the tag workflow.
- Native Windows `v1.3.0` release smoke passed with the persisted three-row watchlist: client area `208×125`, live BTC/ETH/ZEC real-USD values and UTC changes rendered, and closing hid the window while the exact test process remained resident. The test process was then terminated explicitly.
- Runtime-equivalence audits found `main.ts`/`price-format.ts` emits identical to their prior JavaScript and only type-guard/equivalent narrowing differences in watchlist/price-feed; test counts and assertions were preserved.
- No Rust `.rs` source, capability, permission, HTML, CSS, CSP origin, or window-envelope value changed. Cargo/package/Tauri metadata changed only as required to synchronize `1.3.0`. `git diff --check` passes with only working-copy LF→CRLF notices.

Still not verified:

- Current `main` has no main/PR CI result. The manual/tag workflow now runs complete frontend checks on Node 20, but the workflow change has not run remotely and still omits Rust fmt/check/clippy.
- The current feature set has not had full real-device runtime acceptance on macOS Intel/Apple Silicon or Linux/Wayland.
- Code signing and Apple notarization are not configured. Auto-update is deliberately outside the current requested product scope, not a failed verification.

Documentation-only final checks:

- all local relative Markdown links resolve;
- `git diff --check` passes (PowerShell reports only LF→CRLF working-copy notices);
- sensitive token/private-key signatures and personal absolute paths were not found in the scoped source/config/documentation set;
- there are no staged changes; live Git contains only the documented uncommitted migration and generated outputs remain ignored;
- no commit, push, tag, release edit, or artifact publication was performed for this migration.

Consult live `git status` before acting; any later change is outside this completed checkpoint.

### Development environment snapshot

Detected on the current Windows machine during this checkpoint:

- Node.js `v24.14.1`, npm `11.11.0`; use `npm.cmd` in PowerShell.
- Rust/Cargo `1.97.1` stable; MSVC Build Tools and WebView2/Tauri prerequisites are functional.
- Git `2.55.0.windows.2`, GitHub CLI `2.98.0`.
- Project CLI dependency `@tauri-apps/cli` is pinned to `2.11.4`; lockfiles are authoritative for resolved Rust/Node dependencies.
- Windows Internet Settings had a proxy enabled. This is mutable machine state, not application configuration; query it live when diagnosing networking rather than copying an address into code.

## Next Recommended Action

1. Stage and review the authorized migration/release preparation, then commit and push it to `main`.
2. Create and push the new immutable `v1.3.0` tag at that verified commit.
3. Monitor the full workflow and verify all five Release assets, names, sizes, digests, downloads, and UTF-8 release text before declaring completion.

## New Thread Bootstrap

1. Read `AGENTS.md`.
2. Read `docs/INDEX.md` and `docs/CURRENT_STATE.md`.
3. Run `git status --short --branch`; the working tree is expected to contain this completed uncommitted migration, so preserve it and understand any newer changes.
4. Release `v1.3.0` is explicitly authorized and in progress. Resume from **Next Recommended Action** without changing the chosen version or reusing an older tag.
