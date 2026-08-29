# Current Development State

Checkpoint date: 2026-08-30 (Asia/Shanghai)

## Current Objective

Complete and deliver dynamically discoverable stock-related USDT-perpetual market data without hard-coding MU, while keeping crypto spot semantics unchanged. The source checkpoint is versioned `1.4.0`; this turn is authorized to commit/push it and build a local Windows installer, but not to create a tag or GitHub Release.

## Current Status

- Branch/upstream: `main` tracking `origin/main`.
- The stock-perpetual feature, tests, configuration, README, documentation, and synchronized version metadata form one scoped `1.4.0` source checkpoint. No unrelated user edits were identified.
- The user explicitly authorized committing/pushing this source checkpoint and building its local Windows installer on 2026-08-30.
- Published `v1.3.0` remains the latest release. No `v1.4.0` tag or GitHub Release is authorized or created; a source push is not a release.
- Source version is synchronized to `1.4.0` in package, Cargo, lockfile, and Tauri metadata.
- No Rust `.rs` source, Tauri capability, window dimension, or IPC command has changed.
- Expected after the authorized operation: a clean `main` synchronized with `origin/main`; always confirm with live Git state.

## Completed

- Reconfirmed the repository handoff, live Git state, existing USD/UTC/mapping decisions, and the published `v1.3.0` baseline.
- Researched current official public/keyless exchange APIs instead of implementing a single MU special case.
- Added independent catalog discovery:
  - Coinbase online real-USD crypto spot products.
  - Bybit U.S. stock-class linear USDT perpetuals filtered by official region/type/status/quote/settlement metadata.
  - Gate active non-delisting stock-class USDT perpetual contracts.
- Added a canonical `{TICKER}-USDT-PERP` model displayed as `{TICKER}.P`, with exact Bybit/Gate symbols, quote currency, market type, and asset class preserved in validated local storage.
- Bybit-only and Gate-only entries are searchable; exact ticker matches merge into dual-source coverage. Aliases are never guessed.
- Catalog failures are isolated. Any valid provider can populate search, and a transient stock-directory failure preserves the last validated mapping for an already selected product.
- Added Bybit/Gate WebSocket subscriptions, subscription-ACK validation, source-specific REST price fallback, and exact same-source UTC+0 daily-open acquisition.
- Extended quote selection, stale state, request cancellation/revision guards, source labels, and the visible `USD/USDT` mixed-market indicator.
- Added exact Bybit/Gate HTTPS/WSS CSP origins without wildcard origins or wider Tauri permissions.
- Added regression coverage for directories, Gate-only products, persistence refresh, search, WebSocket/REST parsing, subscriptions, same-source UTC open/change, fallback, and CSP.
- Updated the stable architecture, market-data, decisions, known-issues, backlog, and public README semantics for the new product class.
- Synchronized application metadata to `1.4.0` and built the ignored, unsigned local Windows NSIS installer.

## In Progress

The scoped implementation and local verification are complete. No product implementation or release publication remains in progress.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `AGENTS.md` | Persistent guardrails, including the explicitly approved stock-related USDT-perpetual exception |
| `docs/ARCHITECTURE.md` | Mixed product model, module ownership, native/security boundaries |
| `docs/MARKET_DATA.md` | Authoritative discovery, exact mapping, provider, failover, and UTC-open semantics |
| `docs/DECISIONS.md` | Accepted product-class amendment and exact-source decisions |
| `docs/KNOWN_ISSUES.md` | Derivative semantics, delisting behavior, and platform limitations |
| `src/watchlist.ts` | Independent catalogs, canonical product model, persistence, merge/search logic |
| `src/price-feed.ts` | Six market sources, three REST fallbacks, selection, and same-source UTC state |
| `src/main.ts` / `src/index.html` | Product-aware UI labels, catalog refresh, add/remove flow |
| `src-tauri/tauri.conf.json` | Exact Bybit/Gate CSP origins and generalized bundle description |
| `tests/watchlist.test.ts` | Catalog/filter/merge/persistence/search failure-boundary coverage |
| `tests/price-feed.test.ts` | Bybit/Gate parser, transport, fallback, and UTC-change coverage |
| `tests/ui.test.ts` | UI envelope, tooltip prohibition, and exact CSP constraints |

## Current Implementation

The frontend remains strict TypeScript emitted by `tsc` as unbundled browser-native ES modules. Opening the manager starts bounded, concurrent Coinbase/Bybit/Gate catalog requests. Search combines every valid directory result:

- Coinbase IDs remain real-USD crypto spot.
- Bybit uses official `underlyingTicker`, `symbol`, and `fullName` after strict U.S./USDT linear-perpetual filtering.
- Gate uses official active stock-class contract names.
- Equal canonical tickers merge exact coverage; different aliases remain distinct.

Selected stock-related products persist their exact source symbols and stream immediately on later launches. Refresh replaces mappings only when the relevant directory succeeded; a failed directory does not erase a working saved mapping.

`PriceFeed` creates only the provider connections supported by selected products. USD spot continues through Coinbase/Kraken/Bitstamp/Bitfinex. Stock-related perpetuals use Bybit and/or Gate WebSockets and source-specific HTTPS fallback. Every displayed percentage uses the current selected exchange product's own UTC-day open. No underlying-stock, cross-provider, or rolling-24-hour value is substituted.

The native Rust shell still owns the fixed `208px` width, dynamic height, tray lifecycle, and close-to-hide behavior.

## Current Problems

- Bybit/Gate runtime behavior has not been exercised on real macOS WKWebView or Linux WebKit/Wayland.
- Stock-related entries are exchange perpetual derivatives, not shares; funding, leverage, regional eligibility, liquidity, and price behavior can differ from the underlying market.
- An entirely delisted persisted product is preserved rather than silently removed and may remain stale until the user deletes it.
- Existing unrelated low-priority issues remain in `docs/KNOWN_ISSUES.md`.

## Verification State

Current feature work, verified on 2026-08-30:

- `npm.cmd run check`: passed; strict application/test TypeScript checks, 68/68 Node tests, and a clean ES2019 frontend emit succeeded.
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 2/2 Rust tests. It emitted only the already documented benign MSVC import-library linker message.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed at version `1.4.0` with the frontend pre-build. The ignored unsigned NSIS `Crypto Top_1.4.0_x64-setup.exe` is 1,143,958 bytes with SHA-256 `7F0F6D599693D25723447D5DF5467D63BBD5D19DF4C288308F734EB853204ACD`.
- Native Windows release-binary smoke passed on the same feature code before the version-only `1.4.0` metadata synchronization:
  - original five-product local watchlist was preserved;
  - manager client height was capped at 170px and the normal five-row client remained `208×158` with internal scrolling;
  - search `MU` returned `MU.P` with Micron metadata, and search `BA` returned the Gate-only `BA.P` plus related catalog entries;
  - adding MU produced a live `MU.P 938.37` quote and `+0.77%` same-source UTC change during the snapshot, with visible `USD/USDT` and `CB/GT` source labels;
  - the temporary MU entry was removed and the prior BTC/ETH/SOL/ZEC/UNI watchlist restored;
  - a native close event hid the window while the exact process remained resident; the test process was then stopped explicitly.
- Live official API snapshot on 2026-08-29: Bybit returned 168 stock-class instruments, 150 passed strict U.S./USDT filters; Gate returned 370 active stock-class contracts; 118 tickers matched exactly. MU was present as Bybit `MUUSDT` and Gate `MU_USDT`.
- Bybit/Gate REST CORS was verified with Tauri's origin, and both MU daily-candle APIs returned a UTC 00:00 candle during research.
- `git diff --check`: passed with only expected Windows LF-to-CRLF notices.
- All local relative links across `AGENTS.md`, `README.md`, and `docs/*.md` resolve.

Not yet verified: real macOS/Linux runtime behavior, signing, and notarization.

Published baseline:

- `v1.3.0` at release commit `c1738ed9e8c7f7b7c078f84ff2a54f8c366b884c` previously passed 58/58 TypeScript tests, Rust fmt/test/check/clippy, Windows NSIS build/native smoke, and the five-asset cross-platform tag workflow. Those older results do not replace the `1.4.0` verification above.

## Next Recommended Action

1. Confirm live Git state is clean and `main` matches `origin/main`; investigate any later change before acting.
2. Keep the local unsigned `1.4.0` NSIS as a development artifact; it is ignored and is not a published multi-platform release.
3. Only if the user separately authorizes a release, follow `docs/RELEASE.md` to create immutable tag `v1.4.0` and verify all five workflow-built assets. Never move or overwrite `v1.3.0`.

## New Thread Bootstrap

1. Read `AGENTS.md`, `docs/INDEX.md`, and this file.
2. Run `git status --short --branch`; this checkpoint is expected to be clean and synchronized after the authorized push, so preserve and understand any newer changes.
3. Read `docs/MARKET_DATA.md` and the amended market decisions before changing provider logic.
4. There is no active product or release task. Continue only from a new explicit objective; do not restart with a single-MU implementation.
