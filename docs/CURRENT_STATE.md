# Current Development State

Checkpoint date: 2026-08-22 (Asia/Shanghai)

## Current Objective

There is no active product-code objective. The most recent authorized feature work—compact self-selected coins plus four free real-USD sources—was completed, committed, and pushed. The user subsequently authorized committing and pushing this documentation checkpoint. Any next implementation or formal release still requires a new explicit user request.

## Current Status

- Branch/upstream after the documentation push: `main` tracking `origin/main`; use live Git for the documentation commit hash.
- Most recent product-code commit: `3f68c6d4d2a4f8f50df3f12a2740b760454565b3` (`feat: add compact multi-source crypto watchlist`). The documentation-only checkpoint commit follows it without changing product source/config/tests.
- Product-code baseline described as `v1.2.1-3-g3f68c6d` before the documentation commit. No new tag was created.
- Source version remains `1.2.1` in package/Cargo/Tauri metadata.
- Latest published GitHub Release is still `v1.2.1`; it has five platform assets but predates the current watchlist/four-source implementation.
- No known blocking business bug and no product code is in progress.

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

## In Progress

No product implementation is in progress.

No documentation work remains in progress after this checkpoint push. A new thread should still run `git status --short --branch` before acting and preserve any later user changes.

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
| `src/price-feed.js` | Four-source `PriceFeed`, resilient connections, fallback and UTC state |
| `src/watchlist.js` | Product/catalog/persistence and exact provider mappings |
| `src/main.js` | Watchlist UI and render/native-command orchestration |
| `src-tauri/src/lib.rs` | Tray/window/always-on-top/dynamic-height behavior |
| `tests/` | 58 current JavaScript regression tests across market data, watchlist, formatting, UI/CSP |
| `.github/workflows/build-desktop.yml` | Tag/manual build matrix and Release publishing |

## Current Implementation

The static frontend loads the persisted watchlist, constructs a `PriceFeed`, opens provider sockets, and coalesces state rendering. Coinbase covers every selected product. Kraken and Bitfinex currently have verified BTC/ETH mappings; Bitstamp adds exact intersections from its official enabled USD spot catalog. Selection briefly prefers Coinbase, then the newest healthy WebSocket, then Coinbase REST. Each displayed change uses an open cached for the same provider/product/current UTC day.

Adding/removing products calls `PriceFeed.setProducts`, which rebuilds affected subscriptions, aborts obsolete REST work, and uses revision guards against late writes. Rust owns the window/tray lifecycle and clamps height; the frontend does not receive arbitrary resize permission.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`MARKET_DATA.md`](MARKET_DATA.md) rather than expanding this volatile snapshot.

## Current Problems

- Current main has not been released. The published `v1.2.1` binaries do not contain the newest features.
- The newer automatic Release job has never been exercised end-to-end by a tag created after that job was added.
- Real macOS/Linux runtime smoke coverage, code signing/notarization, and several low-priority quality gaps remain. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).
- No blocker prevents local development or a future versioned release.

## Verification State

Verified against product-code commit `3f68c6d` during the feature/checkpoint work unless explicitly qualified below. The documentation push did not change product source, configuration, or tests:

- `npm.cmd run check`: passed, 58/58 Node tests plus syntax checks for all four source modules.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 2/2 Rust tests.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed; latest rebuilt local NSIS was 1,140,136 bytes with SHA-256 `C150833FEF38F40AFF6C333044840C0F9091E2363D4BE2B494E1A0F3841E9FF8`. It is unsigned, ignored, reports version 1.2.1, and must not be uploaded over the old release.
- An earlier native Windows debug smoke after the four-source integration showed `208×92` default content and working live price/UTC display without disturbing the installed app process. It was not rerun after the final mapping/ACK hardening; no UI or native-window code changed afterward, but exact-HEAD native runtime smoke remains not verified.
- Sensitive-signature scan before the feature commit: no embedded remote credentials, common token signatures, or private-key files found.
- GitHub read-only check on 2026-08-22: `v1.2.1` exists with five assets and readable Chinese; HEAD `3f68c6d` has no GitHub check runs/statuses.

Not verified:

- No standalone JavaScript lint is configured.
- No TypeScript/typecheck is configured (the frontend is JavaScript).
- Current HEAD has no main/PR CI result; existing workflow runs only on manual dispatch or tags and uses `npm test`, not the complete local check set.
- The current feature set has not had full real-device runtime acceptance on macOS Intel/Apple Silicon or Linux/Wayland.
- Code signing and Apple notarization are not configured. Auto-update is deliberately outside the current requested product scope, not a failed verification.

Documentation-only final checks:

- all local relative Markdown links resolve;
- `git diff --check` passes (PowerShell reports only LF→CRLF working-copy notices);
- sensitive token/private-key patterns and personal absolute paths were not found in the new documentation;
- the staged set for the checkpoint contains only the documented migration paths;
- post-push `git status` is expected to be clean and synchronized with `origin/main`.

Consult live `git status` before acting; any later change is outside this completed checkpoint.

### Development environment snapshot

Detected on the current Windows machine during this checkpoint:

- Node.js `v24.14.1`, npm `11.11.0`; use `npm.cmd` in PowerShell.
- Rust/Cargo `1.97.1` stable; MSVC Build Tools and WebView2/Tauri prerequisites are functional.
- Git `2.55.0.windows.2`, GitHub CLI `2.98.0`.
- Project CLI dependency `@tauri-apps/cli` is pinned to `2.11.4`; lockfiles are authoritative for resolved Rust/Node dependencies.
- Windows Internet Settings had a proxy enabled. This is mutable machine state, not application configuration; query it live when diagnosing networking rather than copying an address into code.

## Next Recommended Action

1. Run `git status --short --branch` and understand any changes made after this checkpoint.
2. Read `AGENTS.md` and `docs/INDEX.md`; do not edit product code until the user supplies a new objective.
3. If the user explicitly asks to publish the current product work, follow `docs/RELEASE.md`: choose a version newer than 1.2.1, synchronize every version source, rerun checks/build, tag, and verify all five assets. Do not reuse `v1.2.1`.

## New Thread Bootstrap

1. Read `AGENTS.md`.
2. Read `docs/INDEX.md` and `docs/CURRENT_STATE.md`.
3. Run `git status --short --branch`; the checkpoint itself should be clean, so understand and preserve any newer changes.
4. There is no active product task. Wait for the user's explicit next objective; if it is a release, start with `docs/RELEASE.md`.
