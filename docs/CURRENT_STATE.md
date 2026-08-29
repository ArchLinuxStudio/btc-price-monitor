# Current Development State

Checkpoint date: 2026-08-29 (Asia/Shanghai)

## Current Objective

There is no active product-code objective. `v1.3.0`, containing the multi-product/four-source feature set and strict TypeScript migration, was published and fully verified on 2026-08-29.

## Current Status

- Branch/upstream: `main` tracking `origin/main`; the release preparation commit was pushed and the post-release documentation finalization follows it without product changes.
- Release product commit: `c1738ed9e8c7f7b7c078f84ff2a54f8c366b884c` (`release: prepare v1.3.0`).
- Annotated tag `v1.3.0` points to `c1738ed` locally and remotely; published tags were not moved or overwritten.
- Source version is synchronized to `1.3.0` in package/Cargo/Tauri metadata.
- Latest published GitHub Release is [`v1.3.0`](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.3.0), titled `Crypto Top v1.3.0 · 多币种四源版`; it is public, non-draft, and non-prerelease.
- The previous `v1.2.1` tag and five assets remain untouched.
- The user explicitly authorized committing, pushing, and publishing this release on 2026-08-29; those operations are complete.

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
- Cross-platform release workflow completed its first production end-to-end run for `v1.3.0`: four build runners succeeded and the release job published five verified assets.
- This checkpoint split the former monolithic `CODEX_CONTEXT.md` into `AGENTS.md` and routed `docs/` documents, then committed and pushed that migration with explicit user authorization.
- All four frontend modules and all four Node test files now use strict TypeScript; source imports still emit as native `.js` browser-module specifiers.
- The framework-free build/watch path emits ES2019 modules into ignored `dist/`, copies HTML/CSS byte-for-byte, and makes Tauri consume that output without changing CSP, permissions, window settings, or Rust/Cargo source.
- TypeScript/frontend, Rust, Windows NSIS, and native Windows behavior verification are complete for this migration.

## In Progress

No implementation or release operation remains in progress.

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

- Real macOS/Linux runtime smoke coverage, code signing/notarization, and several low-priority quality gaps remain. See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md).
- No blocker prevents local development or a future versioned release.

## Verification State

Verified on 2026-08-29 against release commit `c1738ed` and the published `v1.3.0` artifacts:

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
- GitHub Actions run [`33224614032`](https://github.com/ArchLinuxStudio/btc-price-monitor/actions/runs/33224614032) passed: Windows x64, Linux x64, macOS Apple Silicon, macOS Intel, and `Publish release assets` all completed successfully.
- Release `v1.3.0` was created with readable UTF-8 Chinese title/body and exactly five assets. Every asset was downloaded through GitHub CLI; local size and SHA-256 matched GitHub's uploaded digest:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `Crypto.Top_1.3.0_x64-setup.exe` | 1,141,335 | `b8429e1305cb13de7098db25ca49191887c6601d27a73f9271bdebc4902c252c` |
| `Crypto-Top_1.3.0_linux-amd64.AppImage` | 79,423,992 | `ab801ffc16acfad7ba6df3cce0f2b99a190078fcab462dbb33d20df5769d7721` |
| `Crypto-Top_1.3.0_linux-amd64.deb` | 1,528,402 | `aa2064000e48c2a8461d9c1b9d741e7d778520211ee4496acf7f9e0fa7d5445e` |
| `Crypto-Top_1.3.0_macos-aarch64.dmg` | 1,706,940 | `b7a9980669c3d320cf4a5744d8714bc21ad21fedc77db75d8e02edff5e5ed041` |
| `Crypto-Top_1.3.0_macos-x64.dmg` | 1,797,353 | `67368374c9aa4d242450d402a9c97de6c50bab16cd7362ff33b780d976d41e62` |

- GitHub's latest-release API returns `v1.3.0`; the remote annotated tag dereferences to `c1738ed`.

Still not verified:

- There is still no ordinary main/PR workflow. The `v1.3.0` tag workflow ran complete frontend checks on Node 20, but tag CI still omits Rust fmt/check/clippy; those passed locally.
- The current feature set has not had full real-device runtime acceptance on macOS Intel/Apple Silicon or Linux/Wayland.
- Code signing and Apple notarization are not configured. Auto-update is deliberately outside the current requested product scope, not a failed verification.

Documentation-only final checks:

- all local relative Markdown links resolve;
- `git diff --check` passes (PowerShell reports only LF→CRLF working-copy notices);
- sensitive token/private-key signatures and personal absolute paths were not found in the scoped source/config/documentation set;
- generated `dist/`, local installers, smoke screenshots, release notes input, and downloaded verification assets remained ignored and were not committed;
- release commit `c1738ed`, `main`, annotated tag `v1.3.0`, UTF-8 release text, and five assets were all verified after publication.

Consult live `git status` before acting; any later change is outside this completed checkpoint.

### Development environment snapshot

Detected on the current Windows machine during this checkpoint:

- Node.js `v24.14.1`, npm `11.11.0`; use `npm.cmd` in PowerShell.
- Rust/Cargo `1.97.1` stable; MSVC Build Tools and WebView2/Tauri prerequisites are functional.
- Git `2.55.0.windows.2`, GitHub CLI `2.98.0`.
- Project CLI dependency `@tauri-apps/cli` is pinned to `2.11.4`; lockfiles are authoritative for resolved Rust/Node dependencies.
- Windows Internet Settings had a proxy enabled. This is mutable machine state, not application configuration; query it live when diagnosing networking rather than copying an address into code.

## Next Recommended Action

1. Run `git status --short --branch` and understand any changes after this documentation finalization.
2. No release recovery action is required; `v1.3.0` is complete. Future product or maintenance work requires a new explicit objective.
3. For any future release, choose a version newer than `1.3.0`, follow `docs/RELEASE.md`, and never move or overwrite existing tags.

## New Thread Bootstrap

1. Read `AGENTS.md`.
2. Read `docs/INDEX.md` and `docs/CURRENT_STATE.md`.
3. Run `git status --short --branch`; this release/documentation checkpoint is expected to be clean and synchronized with `origin/main`, so preserve and understand any newer changes.
4. There is no active product or release task. Start only from a new explicit user objective.
