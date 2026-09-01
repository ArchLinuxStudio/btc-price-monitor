# Build and Release Operations

This document is the operational authority for packaging and publishing. Exact workflow behavior remains defined by `.github/workflows/build-desktop.yml`.

## Version sources

Before a formal release, choose a new SemVer version and synchronize all applicable sources:

- `package.json`
- both the top-level `version` and `packages[""].version` in `package-lock.json`
- `src-tauri/Cargo.toml`
- local package entry in `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`

Published tags/releases must not be moved or overwritten. The current main/release relationship is volatile; see [`CURRENT_STATE.md`](CURRENT_STATE.md) and query GitHub before acting.

## Local commands

Install and verify from the repository root:

```powershell
npm.cmd ci
npm.cmd run check
cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo check --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings
git diff --check
```

Windows NSIS build:

```powershell
npm.cmd run build:windows
```

Output is under `src-tauri/target/release/bundle/nsis/`. macOS and Linux bundles must be built on suitable target runners/systems; do not relabel a Windows artifact or otherwise fabricate cross-platform bundles.

## CI matrix and triggers

`.github/workflows/build-desktop.yml` runs on:

- Manual `workflow_dispatch`: builds and retains Actions Artifacts only.
- Push of a `v*` tag: builds all targets, then publishes/updates the corresponding GitHub Release.

Build targets:

- Windows x64 NSIS
- Linux x64 AppImage
- Linux x64 deb
- macOS Apple Silicon dmg (minimum macOS 12.0)
- macOS Intel dmg (minimum macOS 12.0)

`uploadWorkflowArtifacts: true` alone does not attach files to a GitHub Release. The explicit `release` job downloads artifacts, normalizes names, and invokes `gh release upload`.

## Release asset names

- `Crypto.Top_<version>_x64-setup.exe`
- `Crypto-Top_<version>_linux-amd64.AppImage`
- `Crypto-Top_<version>_linux-amd64.deb`
- `Crypto-Top_<version>_macos-aarch64.dmg`
- `Crypto-Top_<version>_macos-x64.dmg`

The Windows dot after `Crypto` is intentional compatibility with v1.1.0+ assets and `--clobber`. Do not casually normalize it to a hyphen unless historical releases and workflow behavior are migrated together.

## Formal release checklist

1. Confirm explicit user authorization to release, not merely to commit/push source.
2. Review `git status`, choose a new version, and synchronize all version sources.
3. Run TypeScript/frontend and Rust checks plus a relevant native smoke test.
4. Build and inspect the local Windows installer when on Windows; do not publish a stale same-version verification package.
5. Commit/push authorized changes to `main`.
6. Create and push a strict `vMAJOR.MINOR.PATCH` tag matching the package version.
7. Wait for every matrix build and the release job; do not report success while jobs are incomplete.
8. Verify the Release has exactly the five expected platform assets, correct names/sizes/digests, working downloads, and readable UTF-8 Chinese text.
9. Confirm the `Verify macOS 12 deployment floor` step passed for both macOS build jobs before publication; it mounts the final generated DMG read-only, then reads the shipped app's `LSMinimumSystemVersion` and every reported Mach-O deployment target and requires all values to equal `12.0`. Independently inspect downloaded bundles when tooling is available.
10. When possible, smoke-test the actual artifacts on real Windows, macOS 12.x at the supported floor (both architectures as available), and a mainstream Linux desktop/Wayland environment.

## Failure and safety notes

- If a release attempt fails for a transient runner/service reason and its tag source is unchanged, rerun the complete workflow. Rerunning only the release job can lose access to artifacts from a previous attempt.
- If recovery changes source or workflow code after a public tag was pushed, preserve that failed tag and increment the patch version for a new commit/tag. Never move, delete, or overwrite the public tag to make it contain the repair.
- `gh release upload --clobber` deletes/replaces a same-name asset and is not atomic. A mid-upload failure requires a full verification/recovery pass.
- An existing Release keeps its title/body; the workflow clobbers binary assets. A new Release uses generated notes.
- Old tag runs do not gain newer workflow logic. Historical missing assets were repaired manually; GitHub Actions artifacts may expire and are not a permanent archive.
- Tauri's DMG builder may remove the temporary `bundle/macos/*.app` after producing the disk image. Post-build macOS metadata validation must therefore mount and inspect the final DMG rather than rely on that temporary path.
- Static tests that inspect repository text must accept both LF and CRLF checkout line endings so Windows CI does not reject valid source solely because of Git newline conversion.
- Release text once became `????` through a Windows encoding path. Use UTF-8 input/bytes and verify the resulting GitHub page/API response after writing Chinese text.
- `bundle.licenseFile` generates `src-tauri/target/release/nsis/x64/license_file` and a non-empty `!define LICENSE` in the generated `installer.nsi`. Inspect those files to verify the NSIS license page without changing the user's installation. Do not automate through the live installer's `Next`/`I Agree` controls unless replacing the installed application is explicitly authorized: NSIS can reuse the same dialog control while advancing, and an automation invocation advanced into installation during the 2026-08-30 About/GPL checkpoint before cancellation took effect.
- Use existing Git Credential Manager/GitHub runner credentials without printing or copying tokens. Never write credentials into repository files.
