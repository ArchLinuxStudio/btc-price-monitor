# Current Development State

Checkpoint date: 2026-09-10 (Asia/Shanghai)

## Current Objective

Publish the completed chart feature and zoom refinement as `v1.7.0`. The user explicitly authorized source push and a new GitHub Release after repository restoration. Scope includes version synchronization, release checks, local Windows build/native smoke, commit/push/tag, all CI matrix builds and verification of five public assets. Installation and unrelated backlog fixes remain outside this request.

## Current Status

- Release preparation and local verification have passed. The next step is committing and pushing the reviewed changes, then creating/pushing the new `v1.7.0` tag.
- All six version fields in the five authoritative files are `1.7.0`; dependencies, native permissions, CSP and workflow code are unchanged.
- The latest public Release is still `v1.6.2`, which predates the entire chart feature. New Release notes cover the full chart feature as well as the final zoom reserve, and disclose the existing Bybit mapping limitation.
- No new release tag or public assets exist yet. Do not report publication complete until every CI job and all five asset/download checks pass.

## Git Worktree Snapshot

At release preparation, branch `main` tracks `origin/main`; HEAD and the live remote branch both resolve to `52d572654f5381bf0894a8800aa721e00d3613e0`. The latest remote tag `v1.6.2` resolves to `894dffbdfbcdb2c154976ebb65555cff5b0e49ef`. No existing tag was changed.

The reviewed worktree contains 16 modified files, with no staged/untracked files before release staging:

| Files | Provenance |
| --- | --- |
| `src/chart-viewport.ts`, `src/chart-navigation.ts`, `src/chart.ts` | Completed zoom reserve from the previous task; preserved byte-for-byte during restoration/release preparation |
| `tests/chart-viewport.test.ts`, `tests/chart-navigation.test.ts` | Existing zoom regressions, likewise preserved |
| `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/INDEX.md`, `docs/KNOWN_ISSUES.md`, `docs/TODO.md`, `docs/CURRENT_STATE.md` | Existing zoom/handoff documentation, with current release/acceptance state updates |
| `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json` | Version-only changes from `1.6.2` to `1.7.0` |

Ignored `artifacts/`, `dist/` and `src-tauri/target/` remain local. Prior named installers are preserved. Evidence there is useful on this host but is not guaranteed in another clone.

## Completed

- Recovered the repository context and preserved all pre-existing source/test work.
- Confirmed the complete chart feature since `v1.6.2`, including two-sided pan, confirmed origin, axes/crosshair/prefetch and synchronized current-candle/price guide.
- Completed bounded further zoom-out after all history fits, including sparse 1/9-candle series, terminal pages, cache completion, anchors and cancellation regressions.
- Synchronized `1.7.0` versions and reviewed Chinese Release notes with all five exact asset names and known limits.
- Passed the full frontend and Rust release checks, six browser zoom scenarios and a bounded native Windows smoke.
- Built a new Windows NSIS installer and verified its version, GPL license-page generation and local SHA-256; it has not been installed.

## In Progress

Commit/push/tag, GitHub Actions matrix builds, public Release creation, UTF-8 notes and all-five-asset verification remain to be completed. No product implementation is pending.

## Relevant Files

| Path | Responsibility |
| --- | --- |
| `src/chart-viewport.ts` | Pure slot limits, anchored zoom/pan, geometry, real visible bounds and reset |
| `src/chart-navigation.ts` | Shared visual count limit, pending zoom, terminal/cache completion, demand/prefetch and live tail merge |
| `src/chart.ts` | Controls, rendering, input anchors and lifecycle |
| `tests/chart-viewport.test.ts`, `tests/chart-navigation.test.ts` | Zoom reserve and history/navigation regressions |
| `src/chart-live-candles.ts`, `src/chart-current-price.ts` | Quote lifecycle and synchronized last-close/guide state |
| `src/candle-history.ts`, `src/chart-time-axis.ts`, `src/chart-crosshair.ts` | Exact-source history/origin, real date markers and blank-space inspection |
| Five version files above | Authoritative release version fields |
| `.github/workflows/build-desktop.yml`, `docs/RELEASE.md` | Four target builds, five assets and macOS 12 deployment-floor checks |

## Current Implementation

`maximumCandleViewportCount(total)` allows up to `2 × total` finite visual slots. Open/reset remains the latest `min(120, total)` real candles and the zoom-in floor remains `min(12, total)`. `isCandleViewportFull` means all real candles are visible, including possible blank space, rather than exhausted zoom capacity.

`ChartNavigation.maximumViewportCount` is shared by navigation and the minus-button limit. While older history is queryable, larger zoom intent stays pending at the available-data scale. Completion, query boundaries or a full cache project that intent into the available reserve around its original anchor, including empty terminal pages and older/live cache completion. The reserve creates no candles and does not raise the 4,800-real-candle cache or network budget.

Pan start stays `[1 - count, total - 1]`; real visible bounds drive extrema, dates, summaries and crosshairs. Reverse zoom, drag, End and reset supersede pending intent. Only an aligned latest edge follows live appends. Origin requires confirmed source completion with the actual first candle retained.

Quotes pass through `ChartCurrentPrice → ChartLiveCandles → ChartNavigation`; the price guide derives from the actual last candle close and shares its render frame. Do not restore the rejected independent-live-line/static-OHLC approach. Stable constraints remain in `DECISIONS.md` and `MARKET_DATA.md`.

## Current Problems

- No failing release check or product blocker was found for this scope.
- The separate Bybit symbol-selection defect remains open: a permitted official mapping differing from ticker plus `USDT` fails chart selection, including products whose active source is Gate. The `AMDSTOCKUSDT` example is an offline fixture, not evidence of a current online listing. It is disclosed in the Release notes; see `KNOWN_ISSUES.md` and `TODO.md`.
- Charts support Coinbase/Bybit/Gate only, history is bounded and outage gaps are not fabricated. Packages remain unsigned and macOS unnotarized.
- Full installed-artifact acceptance, macOS 12/Linux runtime acceptance and unrelated CSS/native-command debt remain incomplete. Do not expand this release task into those backlog fixes.

## Verification State

| Check | State | Evidence / scope |
| --- | --- | --- |
| `npm.cmd ci` | **Passed** | `artifacts/release-v1.7.0-npm-ci.log` |
| Strict application/test TypeScript | **Passed** | Fresh `npm.cmd run check` for `1.7.0` |
| Node suite | **Passed: 258/258** | Same command; `artifacts/release-v1.7.0-frontend-check.log` |
| Frontend build | **Passed** | Clean static emit in check and Windows build |
| Rust fmt/test/check/Clippy | **Passed; 7 Rust tests** | Locked checks and `-D warnings`; `artifacts/release-v1.7.0-rust-*.log`, `release-v1.7.0-clippy.log` |
| Browser zoom regression | **Passed: 6 scenarios** | Fresh run; `artifacts/release-v1.7.0-zoom/results.json` |
| Windows NSIS build | **Passed** | `artifacts/release-v1.7.0-windows-build.log` |
| Version/license metadata | **Passed** | All six fields `1.7.0`; installer product/file version `1.7.0`; generated NSIS license file 35,152 bytes and non-empty `!define LICENSE` |
| Native Windows smoke | **Passed, bounded scope** | Local release executable, isolated WebView2 profile; live Coinbase BTC 1h, 120/720 initial/prefetch, guide/last-close equality, 120→168 zoom, drag/crosshair, reset to 120, Escape hides chart while process/main remain alive. Unsupported Bitfinex source also showed its explicit state. `artifacts/release-v1.7.0-local/native-smoke.json` |
| `git diff --check` | **Passed** | Rerun before staging |
| Standalone frontend lint | **Not available** | Strict TypeScript is included above |
| Full installed Windows artifact / all-provider/all-interval native acceptance | **Not verified** | Installer was not executed; bounded native smoke is not full acceptance |
| macOS/Linux runtime and CI deployment floor | **Not verified yet** | Await this release's builds; build metadata alone cannot establish full runtime acceptance |
| Public Release assets/downloads/UTF-8 notes | **Not verified yet** | Publication has not begun |

Browser fixtures use 360/9/1 candles at 1440×900 and 640×400, DPR 2, including reserve limits, proportional geometry, anchor reversal, pan edges, End/reset and origin. Twenty history/metadata requests and six ticker fallback requests were mocked; no unexpected external requests or page/console errors. This rerun uses a distinct ignored harness/output so prior evidence is preserved.

The native smoke's first detached launch disappeared without a Windows crash record; a retained launcher session stayed alive through the full repeated smoke and chart hide. Only the owned test process was cleaned up afterward; the pre-existing installed process and user watchlist were preserved. This is harness evidence, not a product workaround or proof of an application crash.

Local named installer: `artifacts/release-v1.7.0-local/Crypto.Top_1.7.0_x64-setup.exe`, 1,246,302 bytes, SHA-256 `0358E01C5D5EB7BC86C30650315F541C8F4F3206EF516CF439758018CF3EB7EB`, `NotSigned`. Its adjacent `build-info.json` records the dirty `52d5726` preparation source. Public assets must come from the subsequent release tag via CI, not this local verification copy.

## Next Recommended Action

1. Review the final scoped diff and confirm live remote `main` has not advanced, then commit/push the 16 reviewed files.
2. Create and push new tag `v1.7.0`; never move or overwrite existing tags. Wait for all four builds and the release job, including both macOS deployment-floor steps.
3. Apply the prepared UTF-8 Chinese notes, verify exactly five expected public asset names, sizes, SHA-256 digests and real downloads; update this checkpoint with final commit/tag/run/Release evidence and push that documentation update.
4. After publication, await the next user scope. Do not automatically install packages or fix unrelated TODOs.
