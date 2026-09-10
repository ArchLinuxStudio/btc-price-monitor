# Current Development State

Checkpoint date: 2026-09-10 (Asia/Shanghai)

## Current Objective

The authorized source push and `v1.7.0` GitHub Release are complete and verified. This documentation checkpoint records the final result; await a new user scope. The release includes the full chart feature since `v1.6.2` and the final zoom reserve. Installation and unrelated backlog fixes were not performed.

## Current Status

- Release preparation and local verification passed. Commit `88abeac779cd29047b7e64ecd66e49e3062a523a` and annotated tag `v1.7.0` have been pushed and verified against the live remote.
- All six version fields in the five authoritative files are `1.7.0`; dependencies, native permissions, CSP and workflow code are unchanged.
- [Release v1.7.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.7.0) is published and marked latest. Its Chinese title/body match the prepared UTF-8 file and disclose the existing Bybit mapping limitation.
- GitHub Actions run [34436389439](https://github.com/ArchLinuxStudio/btc-price-monitor/actions/runs/34436389439) succeeded: all four builds and the publication job passed, including both macOS 12 deployment-floor steps. All five public assets were downloaded and their names, sizes, file signatures and SHA-256 values verified against GitHub metadata and the CI publication log.

## Git Worktree Snapshot

The source release commit and peeled tag `v1.7.0` are `88abeac779cd29047b7e64ecd66e49e3062a523a`; the annotated tag object is `ac9f490a90f3e23037d58e28635289dfc0c12c90`. No existing tag was changed. The final documentation-only verification commit updates this file, `KNOWN_ISSUES.md` and `TODO.md` on `main`; source/tests/version files are unchanged from the public tag. Recheck live Git for that documentation commit and branch cleanliness rather than treating its self-referential hash as part of this file.

The release commit contains the 16 reviewed files below; before staging there were no staged/untracked or unrelated changes:

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
- Pushed the source and new tag, completed all five CI jobs, published the latest Release with verified UTF-8 Chinese notes, and downloaded/verified all five public platform assets.

## In Progress

None. Source delivery, publication and release verification are complete. No installation or unrelated backlog work is in progress.

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
- CI succeeded with an action-runtime deprecation annotation for checkout/setup-node; the scoped CI maintenance item in `KNOWN_ISSUES.md` / `TODO.md` records it. This was not a failing check.

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
| `git diff --check` | **Passed** | Source commit and final documentation checkpoint |
| Standalone frontend lint | **Not available** | Strict TypeScript is included above |
| Full installed Windows artifact / all-provider/all-interval native acceptance | **Not verified** | Installer was not executed; bounded native smoke is not full acceptance |
| CI matrix and release job | **Passed: 5/5 jobs** | Run `34436389439`, source `88abeac`; all four targets and publication succeeded |
| Both macOS deployment floors | **Passed** | Final DMGs mounted in CI; both shipped apps report `LSMinimumSystemVersion=12.0` and Mach-O `minos=12.0` |
| macOS/Linux real runtime acceptance | **Not verified** | Build/deployment metadata is not full runtime acceptance |
| Public Release assets/downloads | **Passed: 5/5** | Exact filenames, positive sizes, MZ/ELF/ar/koly file signatures, actual public downloads and SHA-256 equality with API/CI logs; downloaded Windows product/file version `1.7.0` |
| Release title/body and latest status | **Passed** | UTF-8 title/body round-trip equals prepared Chinese source; latest API resolves to `v1.7.0`, non-draft/non-prerelease |

Browser fixtures use 360/9/1 candles at 1440×900 and 640×400, DPR 2, including reserve limits, proportional geometry, anchor reversal, pan edges, End/reset and origin. Twenty history/metadata requests and six ticker fallback requests were mocked; no unexpected external requests or page/console errors. This rerun uses a distinct ignored harness/output so prior evidence is preserved.

Native smoke used a retained launcher session and isolated WebView2 profile. Only the owned test process was cleaned up afterward; the pre-existing installed process and user watchlist were preserved.

Local named installer: `artifacts/release-v1.7.0-local/Crypto.Top_1.7.0_x64-setup.exe`, 1,246,302 bytes, SHA-256 `0358E01C5D5EB7BC86C30650315F541C8F4F3206EF516CF439758018CF3EB7EB`, `NotSigned`. Its adjacent `build-info.json` records the dirty `52d5726` preparation source. Public assets below were built separately in CI from tag `v1.7.0`; the local copy is not the public Windows binary.

### Verified public assets

Release published 2026-09-10 12:20:52 Asia/Shanghai; final downloads verified at 16:54:30 the same day. Evidence: `artifacts/release-v1.7.0-downloads/verification.json`, `artifacts/release-v1.7.0-api-final.json`, `artifacts/release-v1.7.0-actions.json`, the publication log and both macOS build logs. Anonymous HTTPS downloads used the existing Windows system proxy after direct CLI connections failed; no application network configuration or TLS policy was changed.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `Crypto.Top_1.7.0_x64-setup.exe` | 1,248,901 | `b9e1f73f1be96bd4c1e0c92b92997d49d2817396f0c1c62e17f8ac3525585ce9` |
| `Crypto-Top_1.7.0_linux-amd64.AppImage` | 79,890,936 | `6d0cde6bd81cd15431d26840ba4af3dd4d04768165e9e45d64470edf504944ca` |
| `Crypto-Top_1.7.0_linux-amd64.deb` | 2,022,462 | `571dc093e3437d306986e00b0b5d57eb66aeb08ac714fe822ed3042abe4be5ac` |
| `Crypto-Top_1.7.0_macos-aarch64.dmg` | 1,868,719 | `19f740c0fddba4a14e960b971c895b3bbb9931de7e60d34bf4207cfef1241754` |
| `Crypto-Top_1.7.0_macos-x64.dmg` | 1,968,226 | `5d1210cd85fc37a4d45ae9b1ed9d7ec5f9928d7168592bbacc438c8adaf0f96f` |

## Next Recommended Action

1. On restoration, check Git and the final documentation verification commit on `main`; preserve any later user changes. The source tag and assets above remain the release baseline.
2. Await the next user scope. Do not repeat publication, install packages or start unrelated TODOs automatically.
3. If installation/native acceptance is requested, use the verified public Windows asset or the appropriate real target system and preserve existing user state. Remaining acceptance criteria are in `TODO.md`.
4. If a product fix is requested, read the relevant stable decision/source and update tests. Any later release must use a new version under `RELEASE.md`; never move or overwrite `v1.7.0`.
