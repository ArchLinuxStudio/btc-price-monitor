# Current Development State

Checkpoint date: 2026-08-30 (Asia/Shanghai)

## Current Objective

Add a cross-platform tray-menu About view that displays the current application version, canonical application icon, GitHub repository address, and an unambiguous GPL license, without changing the monitor UI or its tray-only lifecycle.

## Current Status

- Branch/upstream: `main` tracking `origin/main`.
- This task started from clean synchronized commit `66f3ace843b110016795fc37c44ab879915f21a4` (`feat: add dynamic stock perpetual markets`).
- The working tree now contains only the scoped About/GPL implementation, tests, build-tooling, README, and documentation changes awaiting the authorized commit/push. No unrelated user edits were identified.
- Source version remains synchronized at `1.4.0`; published `v1.3.0` remains the latest GitHub Release.
- The user explicitly authorized committing and pushing this implementation to `origin/main`. No tag or GitHub Release is authorized.
- The main monitor's `208px` envelope, market-data behavior, custom IPC surface, CSP origins, and taskbar/Dock policy are unchanged.
- Installer-page verification unintentionally advanced into installation before cancellation took effect. A near-final unsigned `1.4.0` build replaced the existing per-user installation at `C:\Users\walle\AppData\Local\Crypto Top`; its installer-launched instance remains running, the main window is visible, and About is hidden. The final source and installer differ only by replacing the visually equivalent CSS `inset` shorthand with macOS 10.15-compatible edge declarations, and were deliberately not installed again. That local installation did not itself create a commit, tag, push, or published Release.

## Completed

- Recovered the clean `1.4.0` baseline and inspected the native tray, window lifecycle, static frontend build, capabilities, and related decisions before editing.
- Rejected Tauri's predefined platform About item because the locked Tauri/muda implementation cannot show icon, website, and license consistently across Windows, macOS, and Linux.
- Added a normal tray item, `关于 Crypto Top`, routed through a tested native `TrayAction::ShowAbout` action.
- Added one pre-created, initially hidden, fixed `380×450px` decorated `about` WebView. It is centered/focused when requested and hidden/reused on close, while Quit remains the only process-exit path.
- Kept About outside every IPC capability and added no plugin, remote origin, wildcard permission, inline script, or external navigation behavior.
- Added a local static About page that shows the canonical icon, build-time Tauri version, selectable repository address, GPL name/SPDX identifier, warranty notice, copyright, and a fixed in-window disclosure overlay containing the complete independently scrollable license text.
- Extended the frontend build/watch copier for `about.html`, `about.css`, canonical `assets/app-icon.svg`, and `LICENSE.txt`; version injection reads `src-tauri/tauri.conf.json`, while the root license is HTML-escaped into About and configured as Tauri's bundle license file.
- Adopted `GPL-3.0-only`: added the complete unmodified GNU GPL v3 text, synchronized npm/Cargo metadata, and documented the user-facing and engineering implications.
- Added TypeScript/static regression coverage plus Rust tests for tray action routing and the two managed close-to-hide window labels.
- Updated README, architecture, decisions, known issues, and cross-platform TODO coverage.

## In Progress

The scoped implementation and local verification are complete. Commit and push are explicitly authorized and are the active delivery step; tag/Release operations remain out of scope.

## Relevant Files

| Path | Current responsibility |
| --- | --- |
| `src-tauri/src/lib.rs` | Tray About action, main/About show-hide routing, tray-only exit, monitor layout behavior |
| `src-tauri/tauri.conf.json` | Fixed main monitor plus pre-created hidden About window, shared narrow CSP, application version, bundle license |
| `src/about.html` / `src/about.css` | Script-free About content and fixed auxiliary-window presentation |
| `assets/app-icon.svg` | Canonical icon copied into frontend output; not duplicated in source |
| `scripts/frontend.ts` | Static asset/license copying plus safe About version/license injection before TypeScript emit |
| `src-tauri/capabilities/main.json` | Main-only IPC capability; About deliberately remains outside it |
| `LICENSE` | Complete GNU GPL v3 license text for the `GPL-3.0-only` project grant |
| `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` | Synchronized project-license metadata |
| `tests/ui.test.ts` | About content/window/build/capability constraints plus existing UI/CSP coverage |
| `README.md` / `docs/ARCHITECTURE.md` / `docs/DECISIONS.md` | User behavior and stable About/GPL design decisions |

## Current Implementation

The native shell pre-creates both configured windows. `main` retains its existing compact monitor behavior. `about` starts hidden and has no IPC capability. The tray callback maps stable item IDs to show main, hide main, show About, or exit. Showing About reuses the configured window, centers it, and focuses it; closing either managed window hides it, while tray Quit exits.

The About page is entirely local and script-free. During every clean frontend build, `scripts/frontend.ts` reads the authoritative Tauri version and root license, replaces the `{{APP_VERSION}}` token, injects an HTML-escaped complete GPL text into its fixed disclosure overlay, and copies the canonical SVG icon plus `LICENSE.txt` into `dist/`. The repository address is plain selectable text, so no browser-opener plugin or URL permission was introduced.

The previous USD spot and stock-related perpetual implementation remains unchanged; see `docs/MARKET_DATA.md` for those semantics.

## Current Problems

- The new About window/tray path has not been exercised on real macOS WKWebView or Linux WebKit/Wayland.
- The repository address is intentionally displayed/selectable rather than opened automatically; adding click-to-open later would require a separately reviewed, exact-URL opener permission.
- Existing market/platform limitations remain in `docs/KNOWN_ISSUES.md`.

## Verification State

About/GPL feature work, verified on 2026-08-30:

- `npm.cmd run check`: passed; strict application/test TypeScript checks, 69/69 Node tests, and a clean ES2019 frontend emit succeeded.
- Generated `dist/about.html` contains version `1.4.0` and the complete HTML-escaped GPL text with no remaining template token. Decoding its license block reproduces root `LICENSE` exactly. `dist/LICENSE.txt` is byte-identical to root `LICENSE` (SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`), while `dist/app-icon.svg` is byte-identical to canonical `assets/app-icon.svg` (SHA-256 `AA9CFE8CE1D871AE169C826D909A135C5C0695E66CB333096FDF3F9D56C0D003`).
- `cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check`: passed.
- `cargo test --locked --manifest-path src-tauri\Cargo.toml`: passed, 4/4 Rust tests. It emitted only the already documented benign MSVC import-library linker message.
- `cargo check --locked --manifest-path src-tauri\Cargo.toml`: passed.
- `cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`: passed.
- `npm.cmd run build:windows`: passed at version `1.4.0`. The final ignored unsigned NSIS `Crypto Top_1.4.0_x64-setup.exe` is 1,181,848 bytes with SHA-256 `2EF35503E189181C0D67F60CCD9A59EF31C8ACA68431B643701FDE6563308435`; it is a local verification artifact, not a published Release.
- The generated NSIS `license_file` exists, contains the GNU GPL header, and is referenced by a non-empty `!define LICENSE` in `installer.nsi`. UI Automation reached the installer's native `License Agreement` page with its scrollable document and `I Agree` action, proving the license page is self-contained rather than loaded from the repository at runtime.
- Native Windows tray/About smoke passed against the final release binary while the separate installed instance remained running:
  - UI Automation process-differencing identified exactly one new test-process tray icon; its accessible name remained empty, preserving the no-tooltip constraint.
  - Real right-click opened the native menu containing `显示窗口`, `隐藏窗口`, `关于 Crypto Top`, and `退出 Crypto Top`; the About item was located and clicked by exact Win32 menu text.
  - About opened from that tray action with a `380×450px` client area. Visual inspection confirmed the canonical icon, `版本 1.4.0`, exact GitHub repository address, `GNU General Public License v3.0`, `GPL-3.0-only`, and the warranty/license notice without clipping or a collapsed-page scrollbar.
  - Expanding the disclosure replaced the content with a fixed in-window license view whose complete GPL text scrolls independently and whose close label remains visible.
  - The final release-binary test process exited through the exact tray Quit action. Close-to-hide and same-handle About reuse had already passed on the preceding visually equivalent build before the final CSS compatibility-only edit.
- Installer UI automation reused the advancing button control and completed the per-user install before cancellation took effect. The original running instance ended, NSIS automatically launched one near-final-build instance, and a briefly duplicated manual restart was removed. Exactly one application process remains at the original installation path; the installer action performed no source-control or release-publishing operation.
- Root `LICENSE` is the complete GNU GPL v3 text, 35,149 bytes, SHA-256 `3972DC9744F6499F0F9B2DBF76696F2AE7AD8AF9B23DDE66D6AF86C9DFB36986`; npm/lockfile/Cargo metadata all declare `GPL-3.0-only`.
- `git diff --check`: passed with only expected Windows LF-to-CRLF notices.
- All local relative links across `AGENTS.md`, `README.md`, and `docs/*.md` resolve (10 files, 0 broken links).
- Generated `dist/`, target binaries, and the local NSIS remain ignored; smoke screenshots stayed outside the repository, and none of these artifacts is part of the working tree.

Not verified: real macOS/Linux About/tray behavior, signing, and notarization.

## Next Recommended Action

1. Commit the reviewed About/GPL changes and push them to `origin/main`, as explicitly authorized. Keep the ignored local NSIS out of source control.
2. Verify local `main` and `origin/main` point at the pushed commit and that the worktree is clean.
3. Do not tag or publish a Release unless the user separately authorizes it; any future release must follow `docs/RELEASE.md` and verify all five workflow-built assets without moving or overwriting published `v1.3.0`.

## New Thread Bootstrap

1. Read `AGENTS.md`, `docs/INDEX.md`, and this file.
2. Run `git status --short --branch`; preserve any remaining scoped About/GPL changes and understand any newer edits before acting.
3. Read the GPL/About decisions in `docs/DECISIONS.md` and inspect `src-tauri/src/lib.rs`, `src/about.html`, and `scripts/frontend.ts` before changing this feature.
4. Continue from `Next Recommended Action`; commit/push is authorized for this implementation, but tag/Release publication is not.
