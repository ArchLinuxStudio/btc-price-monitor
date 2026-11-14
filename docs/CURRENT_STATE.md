# Current Development State

## Closed-thread handoff — 2026-11-15

The requested development is complete: tray settings, opt-in login startup, per-second system status, CPU/DIMM temperature collection, default Windows administrator startup, bundled PawnIO, and upload speed with aligned layout. There is no interrupted implementation to resume. The user explicitly requested this documentation handoff and source commit/push on 2026-11-15. Follow the next user's request or acceptance feedback; the backlog is not automatic authorization to start more work.

## Source and release status

- Source implementation and handoff documents were committed as [`4af3c2d`](https://github.com/ArchLinuxStudio/btc-price-monitor/commit/4af3c2dbce171f9b49daf96b59a77714455a0923) and pushed to `origin/main` on 2026-11-15. A live `git ls-remote` confirmed that exact source commit on the remote; this documentation-only checkpoint records the result. The delivery includes all settings/metrics/temperature/installer changes and earlier handoff edits, based on `7a15250`. Inspect live Git before new work.
- Internal version remains `1.7.0`. No version bump, tag, Release, workflow dispatch or artifact publication is part of this request. The workflow runs only on `v*` tags or manual dispatch; ordinary source pushes do not run release CI.
- The last release recorded by the repository is [v1.7.0](https://github.com/ArchLinuxStudio/btc-price-monitor/releases/tag/v1.7.0), source/tag `88abeac779cd29047b7e64ecd66e49e3062a523a`. It predates chart improvements (`ef1d7a7`) and this thread's features. Publication was not re-queried for this source handoff. A future release must inspect remote state and use a new version under `RELEASE.md`.
- Generated `dist/`, native outputs, dependency binaries and `artifacts/` stay ignored. Local evidence/installers are not guaranteed in a fresh clone; their absence is not missing source.

## Delivered behavior

- **Settings:** Tray “设置” opens one reusable `420×280` window; closing hides it. The startup switch saves immediately, serializes writes, refreshes OS state on reopen/focus, and offers retry. Settings-only commands verify the caller window.
- **Login startup:** Opt-in only. Windows uses a current-user InteractiveToken/highest-level scheduled task, without a password or SYSTEM account. Existing enabled HKCU Run entries migrate; disabled/new users are not enabled. Tasks target the protected Program Files executable and retain restricted permissions. Linux uses an XDG desktop entry; macOS uses a LaunchAgent. Identity/path constraints are in `ARCHITECTURE.md`, `DECISIONS.md` and `KNOWN_ISSUES.md`.
- **System status:** Rust samples once per second and exposes a cached main-window snapshot. Upload/download share interface refresh and elapsed interval, with independent counter-reset handling. CPU/physical-memory usage uses OS counters; GPU uses available NVML or identified fallback sensors. Missing/stale/failed readings stay `—`, with three-second freshness and single-flight frontend polling.
- **Layout:** Width remains `208px`, automatic heights `136/169/202px`, footer `44px`. Upload sits above download at left; three equal columns align CPU/memory/GPU utilization above temperature. Numerical text stays 9px. Management hides the footer and remains capped at `170px`. Quote scrolling, height clamping, ordering and feed behavior are preserved.
- **CPU/DIMM temperatures:** Windows bundles a hidden net472 helper with locked LibreHardwareMonitorLib 0.9.6 and RAMSPDToolkit dependencies. Private stdio, response/deadline bounds, stale clearing, restart backoff and parent-EOF exit isolate hardware access. Only current identified CPU/DIMM temperatures count; thresholds, CPU distance-to-TjMax, motherboard values and GPU VRAM are excluded. Checked AMD reads and clearing retained DIMM values prevent failed reads becoming plausible temperatures. The user confirmed CPU temperature works; RAM still reports no readable sensor.
- **Windows installation:** Release executables request normal UAC administrator consent; debug tests stay unelevated. Per-machine NSIS embeds unmodified official PawnIO 2.2.0, verified at build time by pinned hash/publisher. It skips the same/newer driver, handles failure/reboot-required results, and retains the shared driver on uninstall. Matching legacy shortcuts are retargeted without executing HKCU uninstall commands or deleting old user data. Product-scoped task cleanup preserves `/UPDATE` replacement. Different-account UAC credentials target that administrator's profile; see `native/pawnio/README.md`.

The runtime helper never installs drivers or weakens OS security. No CSP origins, broad process/window permissions, framework or bundler were added. Close-to-tray, no-tooltip, exact-symbol and UTC-day-change contracts remain authoritative in `AGENTS.md` and `DECISIONS.md`.

## Source and build entry points

| Area | Files |
| --- | --- |
| Settings/status presentation | `src/settings*.ts/html/css`, `src/system-metrics.ts`, `src/temperature-status.ts`, `src/main.ts`, `src/index.html`, `src/styles.css` |
| Native lifecycle/commands | `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/`, `src-tauri/tauri.conf.json` |
| Startup registration | `src-tauri/src/autostart.rs`, `src-tauri/src/autostart/registration.rs`, `src-tauri/src/autostart/windows_task.rs` |
| Sampling/temperature IPC | `src-tauri/src/system_metrics.rs`, `src-tauri/src/system_metrics/` |
| Collector/licenses | `native/temperature-helper/`, `scripts/build-temperature-helper.ps1` |
| Windows packaging | `src-tauri/windows/`, `src-tauri/tauri.windows.conf.json`, `native/pawnio/`, `scripts/prepare-pawnio.ps1` |
| Regressions | `tests/settings.test.ts`, `tests/system-metrics.test.ts`, `tests/temperature-status.test.ts`, `tests/windows-installer.test.ts`, `tests/ui.test.ts`, inline Rust tests |
| Task-definition check | `scripts/check-windows-startup.ps1` (in memory only, no real task registration) |

On a fresh Windows checkout, install Node/Rust/MSVC prerequisites and .NET SDK 8, then run `npm.cmd ci`. Before direct Cargo checks, generate assets with `npm.cmd run frontend:build` and `npm.cmd run temperature:build`. `npm.cmd run build:windows` prepares frontend/helper/dependency resources automatically. Normal prerequisite setup is authorized by `AGENTS.md`. The installed application requires .NET Framework 4.7.2 or later, not the build SDK. Exact pins/provenance live in manifests/lockfiles and native component READMEs.

## Verification retained from implementation

This closing handoff changes documentation only. Reuse completed checks rather than repeat unchanged suites/builds. Ignored logs/browser harnesses are local evidence; tracked tests are the portable regression source.

| Check | Result and scope |
| --- | --- |
| TypeScript/frontend | Strict application/test checks and static emit passed. Settings, temperature-status and installer regressions passed during implementation; the final upload change passed 17 targeted metrics/UI tests. Unchanged market/chart suites were not repeated. |
| Native tests | Administrator/temperature implementation passed 29 tests with the live sampler ignored. Final startup-adapter tests passed 3/3; final upload tests passed 3/3 with the live sampler ignored. Logs: `artifacts/admin-install-rust-tests.log`, `admin-install-task-tests.log`, `upload-metrics-rust-tests.log`. |
| Formatting/Clippy | Rust formatting and diff checks passed. Clippy `-D warnings` passed for the administrator implementation; the later upload change was covered by focused tests and release compilation. |
| Task Scheduler | In-memory COM definitions, SID/account-name normalization, special-character paths, readback, restricted SDDL/flags and PowerShell parsing passed. No real task was registered/run/deleted. Evidence: `artifacts/admin-install-definition-check.log`. |
| Temperature helper | Locked builds and hardware-free self-tests passed, including conversion/failure/pinned-API checks. User-confirmed CPU readings are hardware acceptance; readable DIMM support is not established. |
| Headless layout | Settings read/write/error cases and `420×280` layout passed. Footer checks passed at `208×136` and `208×202`: upload refresh, matching styles/alignment, zero/extreme/missing/stale/error values, no clipping/overlap and management hiding. Evidence: `artifacts/upload-speed-preview-2026-11-14/browser-results.json` and mock screenshots. |
| Windows package | Final `npm.cmd run build:windows` passed, including helper/PawnIO preparation and NSIS. Only the existing MSVC import-library notice appeared. Log: `artifacts/upload-speed-windows-build.log`. Administrator manifests and hook/resource entries were inspected read-only during packaging integration. |
| Runtime acceptance | CPU temperature confirmed by the user. New installation/upgrade, real login startup and final native UI acceptance remain user-performed. Current Linux/macOS branches have not been compiled/run on real targets in this thread. |

Latest local installer, confirmed present at handoff:

`artifacts/upload-speed-preview-2026-11-14/Crypto.Top_1.7.0_upload-speed-preview_2026-11-14_x64-setup.exe`

It includes all this thread's changes and earlier chart improvements. This is an unpublished preview with internal version 1.7.0, not the published v1.7.0 binary. Rebuild only if source changes or the artifact is unavailable. Do not launch it or take over the desktop for testing; package creation/source push is not installation authorization.

## Remaining work and next-thread route

1. Read `AGENTS.md` → `docs/INDEX.md` → this file, inspect live Git, then open only documents/source relevant to the next request. Completed work does not need resuming; follow new requirements or acceptance feedback.
2. Preserve pending acceptance: final layout, installer/PawnIO handling, real login startup and platform-specific behavior. RAM still has no readable sensor; do not promise elevation or a driver can supply a sensor unsupported by the DIMM/chipset. Start future diagnosis with `KNOWN_ISSUES.md` and the collector README.
3. The independent Bybit chart-selection defect remains unimplemented: the offline AMD / `AMDSTOCKUSDT` fixture is accepted by the catalog but rejected by chart selection, including a Gate-mapped selection. Reproduction/requirements are in `KNOWN_ISSUES.md` / `TODO.md`. This is not a live-catalog claim or authorization to fix it now.
4. Signing/notarization, normal main/PR CI, runtime compatibility and unrelated debt remain in `TODO.md`. Completed settings/metrics implementation is not an open backlog item. Prior chart history is available in Git (`ef1d7a7`, `7a15250`) and stable docs.
5. A future release needs explicit authorization, a new version and five platform assets under `RELEASE.md`. Preserve the standing no-desktop-takeover and no-independent-GitHub-attachment-verification preferences; this source handoff is not release authorization.
