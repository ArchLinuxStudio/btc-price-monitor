# Current Development State

Checkpoint date: 2026-09-11 (Asia/Shanghai)

## Current Objective

Restyle the K-line window to closely resemble TradingView's dark chart interface, as requested after the completed history-loading fix. Preserve exact-source data, smooth-history work, native monitor/window constraints and the static architecture. Deliver a local Windows installer for user-performed visual acceptance; do not install it, control the desktop, commit, push or publish a Release.

## Current Status

The TradingView-style chart implementation, source review, stable docs and local Windows installer are complete. Strict TypeScript, 286 Node tests and clean frontend emit pass. Six headless browser scenarios pass at 1440x900 and 640x400, including the OHLC legend/controls and existing zoom/origin behavior. Live-price regression passes across all five intervals, rollover, delayed/empty responses and close cancellation. All browser tests are headless and do not take over the desktop. The installer is ready for user-performed acceptance; it has not been launched. All source work remains uncommitted, including the preserved history-loading fix.

The prior release task is complete: [v1.7.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.7.0), source/tag commit `88abeac779cd29047b7e64ecd66e49e3062a523a`, was published with successful [CI run 34436389439](https://github.com/ArchLinuxStudio/btc-price-monitor/actions/runs/34436389439). Its source and packaged binaries do not include this local history-loading fix. Version fields remain `1.7.0`.

Standing user preference: do not download or independently verify GitHub-built attachments unless explicitly requested later. `AGENTS.md`, `RELEASE.md` and `DECISIONS.md` record this; existing CI checks remain unchanged. Earlier attachment verification is historical evidence, not a task to repeat.

Additional standing preference recorded after this fix: do not perform UI tests that take over desktop windows, focus, mouse or keyboard or interrupt normal computer use. For interactive/native acceptance, provide a local installer for the user to install and validate themselves. Non-disruptive automated checks remain appropriate. Older native-smoke requirements are superseded; historical evidence does not authorize repeating desktop-control tests. This preference update changes documentation only and preserves the completed local code/test work.

## Git Worktree Snapshot

Branch `main` at `81fc6ffa0b40d67fa28c7ee734e19e84985ddd5f`, matching the local `origin/main` reference. At the start of this visual task, the completed history-loading fix and its tests/docs plus the GitHub-attachment and non-disruptive-testing preference edits were already uncommitted; all are preserved. No staged changes were present.

The prior history-loading task changed `src/chart-navigation.ts`, `src/candle-history.ts`, their tests and stable docs; preference updates also touched AGENTS/RELEASE/TODO. This restyle adds `src/chart.html`, `src/chart.css`, `src/chart.ts`, new `src/chart-price-axis.ts` and its test, plus the test command in `package.json`. No staging, commit, push or version change has occurred. Check live Git before continuing; documentation cannot predict later edits. Ignored `artifacts/` and emitted `dist/` are local evidence/output, not portable project context.

## Completed

- Restyled the chart into a flat dark workspace with a 46px header, 44px left tool rail, five interval controls, in-chart instrument/OHLC legend, axis currency, and a floating bottom zoom/reset group. Kept the 248px default-monitor clearance at widths of at least 960px.
- Added functional crosshair/grid toggles and earliest/latest navigation controls. OHLC uses the actual hovered candle, returns to the latest candle on leave, and clears values in blank history margins. Hover updates the overlay/legend without repainting the candle canvas.
- Aligned candle/current-price colors to green `#26a69a` and red `#ef5350`, with subdued gray crosshair/axes and a flat `#131722` pane. Added bounded nice price ticks and vertical grid lines without altering price scale, candle geometry or history semantics.
- Seven new price-axis unit tests cover ordinary/tiny/huge prices, readable density, boundaries and invalid input. Full current frontend check and six headless UI/zoom scenarios pass; prior smooth-history work below is retained.
- Completed the headless five-interval live-candle/price-marker regression and a separate source review with no actionable findings. Built a fresh Windows NSIS installer, copied it to the distinct local preview path below and recorded source hashes/build provenance. No installation, desktop-control test or publication was performed.

- Recovered chart architecture/decisions, inspected navigation/history/render code and preserved existing worktree edits. The focused baseline passed 102/102 tests.
- Located three avoidable waits: fixed 480-candle prefetch with a one-second delay, unconditional pause after four productive demand pages, and origin metadata blocking nonempty short pages.
- Implemented adaptive 480-1,920-candle prefetch at 250ms intervals and 500ms continuation after fully productive demand batches, with per-page repaint and retained single-flight/cache/cancellation/cooldown safeguards.
- Deferred the first Coinbase/Gate origin probe until an empty page, allowing nonempty short pages to render immediately; retained all existing origin-proof rules.
- Added 21 tests (19 navigation, two short-page delivery) and strengthened existing metadata tests to exercise the deferred probe rather than pass without querying it.
- Compared old/new navigation under a deterministic 400ms-per-page fixture. Initial warming to 720 candles takes 2,800ms before versus 1,300ms now. At a 1,200-candle view the left buffer grows from 480 to 1,920. A single maximum zoom previously stalled at 1,200 cached candles after four requests; now it reaches the 4,800 cap automatically in 9,600ms with per-page updates. These are simulated timings, not exchange/network measurements.
- Verified the emitted chart in Chrome with 400ms candle responses: automatic dense continuation to the cache cap, wide-view buffer refill/stopping, reverse/reset/drag/End, and immediate short-page display before delayed origin metadata. Each scenario retained at most one candle-history request in flight and produced no page/console errors. Synchronized architecture, market-data, decisions and known-limit documentation; TODO contained no completed matching item to remove.

## In Progress

None for the requested implementation. User installation/visual acceptance is pending. Preserve all existing uncommitted work; no unrelated TODO is being implemented.

## Relevant Files

| Path | Responsibility |
| --- | --- |
| `src/chart-navigation.ts` | Pending intent, adaptive prefetch, paced batches, cancellation/cooldown and live-tail/cache merge |
| `src/candle-history.ts` | Frozen exact-source pagination, normalization and confirmed-origin metadata |
| `tests/chart-navigation.test.ts` | 92 navigation regressions including timing, progressive updates, anchors, sparse scans, failures and cancellation |
| `tests/candle-history.test.ts` | 31 provider/history tests including short-page delivery and deferred origin proof |
| `src/chart.html`, `src/chart.css`, `src/chart.ts` | New flat chart layout, real OHLC legend, controls, palette and grid rendering |
| `src/chart-price-axis.ts`, `tests/chart-price-axis.test.ts` | Nice price tick generation with seven numeric edge-case tests |
| `src/chart-viewport.ts` | Existing viewport geometry, unchanged |
| `docs/ARCHITECTURE.md`, `docs/MARKET_DATA.md`, `docs/DECISIONS.md`, `docs/KNOWN_ISSUES.md` | Stable implementation policy and remaining limitations |

## Current Implementation

The chart keeps its local canvas/static ES-module architecture. A 46px flat toolbar and 44px tool rail frame the dark pane; the legend reserves the plot's first 76px and displays actual source/instrument/interval/OHLC. Hovering a real candle updates its values, a blank margin displays dashes, and leave shows the latest retained candle. Four side buttons toggle crosshair/grid or invoke existing earliest/latest navigation. Bottom controls retain existing anchored zoom/reset behavior. Axis ticks use bounded 1/2/2.5/5/10 decimal steps at roughly 64px spacing; candle/price-line colors match. No remote chart library, drawing/indicator/trading placeholder, new source, permission or framework was introduced. Stable rationale is in `DECISIONS.md`.

`ChartNavigation` requests up to 240 real candles per page, serially. Speculation targets `clamp(ceil(viewport.count * 2), 480, 1920)` candles before the visible left edge. The first/next speculative page starts after 250ms, measured from scheduling/previous response completion. Normal latest-120 startup still warms from 240 to 720 cached candles because whole pages may overshoot the target. No other products, intervals or sources are prefetched.

A foreground batch still performs at most four requests. If all four strictly advance the cursor and each actually prepends at least 240 new candles, outstanding demand schedules another batch after 500ms. Queued continuation counts as loading, avoiding a flashing continue button. Every page is immediately delivered through the existing `onChange`/animation-frame path. New intent supersedes obsolete queued demand; reset, End, reverse zoom, cancellation, cache completion and cooldown have regressions.

Incomplete sparse batches, empty/nonadvancing responses and errors retain bounded scanning and explicit continuation. Four insufficient sparse prefetch pages pause speculation; intervening full pages do not consume or reset that sparse budget. Held-pointer events cannot turn failures into retry loops. HTTP 429/403 still block older requests for 60 seconds/10 minutes in the current navigation instance, without automatic cooldown retries. This is not a shared provider/IP limiter.

`createCandleHistoryLoader` returns every nonempty Coinbase/Gate page without initiating metadata. The first empty range may query/cache source-specific origin proof; cached proof applies to later pages. A short/empty bounded window alone cannot prove completion. Bybit's validated empty end-only response keeps its separate completion semantics. No API routes, page size, symbols, fallback, CSP origins or native permissions changed.

The existing `2 x retained real count` maximum visual zoom reserve, latest-120 reset, min-12 zoom floor, two-sided blank pan, wheel anchors and real-only crosshair/date labels remain unchanged. Quotes still flow through `ChartCurrentPrice -> ChartLiveCandles -> ChartNavigation`, with the guide and last actual close synchronized in one frame.

## Current Problems

- Very slow networks, extremely fast navigation or sparse exchange history can still outpace the bounded buffer. This removes avoidable waits; it does not provide an offline archive or unlimited history.
- The separate Bybit symbol-selection defect remains open: permitted official mappings differing from ticker plus `USDT` fail chart selection, including products whose active source is Gate. `AMDSTOCKUSDT` is an offline fixture, not evidence of a current listing. See `KNOWN_ISSUES.md` / `TODO.md`.
- Supported chart sources remain Coinbase/Bybit/Gate; outage gaps are not fabricated. Full installed Windows acceptance and macOS 12/Linux runtime acceptance remain incomplete. Packages remain unsigned/unnotarized. Existing CSS/native-command/CI maintenance debt is outside this task.

## Verification State

| Check | State | Evidence / scope |
| --- | --- | --- |
| Focused navigation/history baseline | **Passed: 102/102** | Before product-code changes |
| Strict application/test TypeScript | **Passed** | Current `npm.cmd run check`, `artifacts/tradingview-style-frontend-check.log` |
| Node suite | **Passed: 286/286** | Current `npm.cmd run check`; includes seven new price-axis tests |
| Frontend build | **Passed** | Clean static emit from the same check |
| Restyled browser UI and zoom/origin regression | **Passed: 6 scenarios** | `artifacts/tradingview-style-2026-09-10/browser/results.json`; 1440x900/640x400, 360/9/1 candles, DPR2, OHLC/hover, toggles, rail navigation, resize/layout, zoom/anchors/origin; headless, no page/console errors |
| Restyled live candle/price guide regression | **Passed** | `artifacts/tradingview-style-2026-09-10/live-regression/results.json`; five intervals, up/down quotes, guide-to-body equality, rollover/delayed/empty tail, historical pan, 640px layout and cancellation; 16 mocked requests, no page/console errors |
| New local Windows installer | **Passed** | `npm.cmd run build:windows`; `artifacts/tradingview-style-windows-build.log`; fresh Rust release compilation and NSIS packaging. Standard linker-output warning only, successful exit |
| Deterministic old/new latency comparison | **Passed: 3 scenarios** | `artifacts/history-loading-2026-09-10/latency-results.json`; fixed 400ms fixture, one flight |
| Existing browser zoom/origin regression | **Passed: 6 scenarios** | `artifacts/history-loading-2026-09-10/zoom-regression/results.json`; 360/9/1 candles, 1440x900 and 640x400, DPR 2; 26 mocked history/metadata requests, no page/console errors |
| Delayed-response browser navigation | **Passed: 4 scenarios** | `artifacts/history-loading-2026-09-10/browser/results.json`; 400ms mocked candle responses, 1,200ms per metadata response; large zoom, wide buffer, reverse/reset/drag/End, short-page origin; one history flight, no page/console errors |
| `git diff --check` | **Passed** | Final product-code/documentation checkpoint |
| Standalone frontend lint | **Not available** | Strict TypeScript included above |
| User installation/native visual acceptance | **Pending user** | Local package is for user-performed verification; do not launch installer or desktop-control tests |
| macOS/Linux runtime acceptance | **Not verified** | No suitable real target acceptance in this local Windows task |
| Rust tests/Clippy/CI for these edits | **Not rerun** | Rust, native configuration, dependencies and CI files unchanged; Windows Rust compilation is part of the package build |

Local browser/latency harnesses and screenshots are under ignored `artifacts/`; committed test files are the portable regression source. Whole-page prefetch can overshoot its target by a page, including when wheel-derived fractional coordinates fall just below a buffer threshold; the browser wide-view fixture retained 3,360 candles for a 1,200-candle view and then stopped. Prior release evidence remains in Git history and existing `artifacts/release-v1.7.0-*` files on this host.

Local deliverable: `artifacts/tradingview-preview-2026-09-11/Crypto.Top_1.7.0_tradingview-preview_2026-09-11_x64-setup.exe`. Its internal version remains `1.7.0`; the distinct filename identifies this newly built preview containing both the restyle and smooth-history fix, not the published `v1.7.0` binary. Adjacent `build-info.json` records build time, base commit/dirty-source description, exact source-file hashes and installer SHA-256 `c4e50da052f925cdb95eb1094fc02cfe437d6a672eb69c7d1bf1d468a82f6be5`. Preview images: `artifacts/tradingview-style-2026-09-10/browser/1440x900-360-default.png` and `640x400-360-default.png` (mock data). The existing named release installers are preserved.

## Next Recommended Action

1. On restoration, check live Git and preserve the completed restyle, smooth-history fix and user preferences. The local implementation/checks/package for this scope are complete.
2. Await the user's visual feedback from the local installer. Do not install it, take over the desktop, repeat completed checks without a new reason or start unrelated TODOs automatically.
3. A later authorized release must use a new version under `RELEASE.md`; never overwrite `v1.7.0`. Preserve the standing preference against downloading or independently verifying GitHub-built attachments.
