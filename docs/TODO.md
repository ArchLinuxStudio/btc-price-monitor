# Remaining Work

This is an executable backlog, not authorization to start work. A future agent must still follow the user's requested scope.

## P0 — Blocking

None. No implementation task is active, and quote-row ordering, the uncapped watchlist, screen-bounded quote-height resize, and compact About/repository-opener work have no known blocker. Current Git and verification state are recorded in `CURRENT_STATE.md`.

## P2 — Release quality and cross-platform confidence

- [ ] Run real runtime smoke tests on supported macOS and Linux environments after the next relevant release candidate.
  - Done when macOS bundle/deployment metadata reports the 12.0 floor and startup plus the fixed ES2025 output are exercised on macOS 12.x; tray visibility/actions (including About and its scoped GitHub opener), monitor/About close-to-hide, always-on-top, main-row mouse/keyboard ordering and restart persistence, screen-bounded quote-height drag (fixed `208px` width, expansion to the available work-area/content limit, overflow behavior, and `170px` management cap), Coinbase/Bybit/Gate catalog and WebSocket/REST connectivity, stock-perpetual search/display, UTC rollover, and packaging startup are recorded for macOS arm64/x64 as available plus a mainstream Linux desktop/Wayland setup.

- [ ] Add signing/notarization before broad end-user distribution.
  - Done when Windows artifacts are signed and macOS artifacts use Developer ID plus notarization, with secrets stored only in protected CI configuration.

- [ ] Harden version consistency checks in the release workflow.
  - Done when the tag is checked against `package.json`, both root entries in `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json`, with a regression test or demonstrated failing mismatch.

- [ ] Add an ordinary main/PR quality workflow or extend CI coverage.
  - Done when non-tag changes run the full TypeScript/frontend tests and Rust fmt/test/check/clippy set without publishing artifacts or Releases.

## P3 — Known technical debt

- [ ] Resolve the isolated extra `}` at `src/styles.css:277` in a separately authorized maintenance change.
  - Done when the token is removed, UI/static tests pass, and the native 208px layout is smoke-tested; consider adding a CSS syntax checker to prevent recurrence.

- [ ] Remove or deliberately restore the unused `minimize_window` IPC command.
  - Done when `src-tauri/src/lib.rs`, `src-tauri/build.rs`, permissions, architecture docs, and tests agree on the reduced command surface; closing must still hide to tray.

- [ ] Improve generated Release notes if the user requests a uniform Chinese download table/digest presentation.
  - Done when new Release text lists all five asset types, matches exact filenames, uses UTF-8, and is verified on GitHub.

## Optional / Revisit only with a product request

- [ ] Add a sanitized real sparse-market Bitstamp OHLC fixture if provider behavior is being changed or investigated.
  - Done when the fixture demonstrates empty/zero-volume versus first-trade buckets and locks the intended UTC-open result without permitting cross-source substitution.

- [ ] Expand custom-product backup coverage for Kraken or Bitfinex using an official, exact, browser-safe instrument directory (or a narrowly allowlisted Rust command).
  - This item applies only to real-USD crypto spot coverage; it is not permission to mix stock-related perpetual semantics into those providers.
  - Done when no pair is guessed, true-USD semantics and licenses are verified, CSP stays narrow, and mapping/failover/UTC tests cover aliases and missing products.

Do not add alerts, autostart, auto-update, or unrelated features merely because they are absent; none is currently requested.
