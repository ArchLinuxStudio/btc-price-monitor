# Agent Development Entry Point

This repository is the persistent source of development context. Do not assume that any chat history is available.

## Before substantial changes

1. Read [`docs/INDEX.md`](docs/INDEX.md).
2. Read [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).
3. Read only the stable/domain documents relevant to the task.
4. Run `git status --short --branch` and preserve all user changes.
5. Confirm the requested scope. Do not turn a diagnosis, review, or documentation task into an implementation task.

## Non-negotiable product constraints

- Keep the app a small Tauri 2 desktop monitor with a static HTML/CSS/TypeScript frontend compiled to unbundled browser ES modules; do not migrate frameworks or add a bundler without explicit approval and evidence.
- Keep the explicit frontend language/type-library baseline at `ES2025`, retain native `ES2022` module output, and require macOS 12.0 or later. TypeScript does not polyfill system WebViews; review newly used language features and runtime APIs against supported macOS WKWebView and Linux WebKitGTK versions instead of assuming the target alone guarantees compatibility.
- The monitor is fixed at `208px` wide. Automatic height is `92/125/158px` for 2/3/4+ rows; quote height may be dragged vertically up to the lesser of selected content and the current monitor's remaining work-area height. Longer watchlists continue scrolling internally, and management height remains capped at `170px`.
- BTC and ETH are fixed in the sense that they cannot be deleted, but every quote row including BTC/ETH may be reordered. There is no application-level count limit for additional supported products: Coinbase online real-USD crypto spot products or officially cataloged stock-related USDT perpetuals. The application must preserve the persisted display order, must not truncate a valid watchlist or disable addition because of selected count, and must not reconnect market feeds for a display-only reorder; provider and machine limits still apply in practice.
- Market data must be free and keyless for the user. Crypto spot USD means real USD; never silently substitute USDT/USDC. Stock-related USDT perpetuals are a separate, explicitly approved category and must be visibly identified with `.P` / `USDT永续`; never describe them as direct share ownership or guess another exchange's symbol.
- Change is the current UTC+0 calendar-day change, calculated from the displayed exchange's own open. Never restore rolling 24-hour change or mix sources.
- Closing the window hides it to the tray. Only the tray Quit action exits the process. Do not restore a taskbar/Dock item or the old redundant minimize button.
- Do not add hover text tooltips (`title`, dynamic `.title`, or tray tooltip). Use `aria-label` for nonvisual descriptions.
- Do not widen CSP origins or Tauri permissions casually. Dynamic size is computed and clamped in Rust to selected content and the current monitor work area; the frontend may request only the quote-height command and must not receive arbitrary resize permission.
- Main-window `dragDropEnabled` remains false so HTML5 row reordering works on Windows; external drops must be prevented in the page. This does not change title-bar window dragging or the bottom height handle.

The rationale and rejected alternatives are authoritative in [`docs/DECISIONS.md`](docs/DECISIONS.md). Market-data details are authoritative in [`docs/MARKET_DATA.md`](docs/MARKET_DATA.md).

## Commands

Use `npm.cmd` on Windows because PowerShell execution policy may block `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run dev
npm.cmd run build:windows

cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo check --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings

git diff --check
git status --short --branch
```

There is no standalone lint script. `npm.cmd run check` performs strict application/test TypeScript checks, the Node test suite through `tsx`, and a clean frontend emit into ignored `dist/`. See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) for the last verified results, not this file.

## Change discipline

- Update tests with changes to market semantics, persistence, UI constraints, native commands, CSP, or release behavior.
- Keep product code and documentation changes scoped. Do not reformat unrelated files.
- Never commit credentials, API keys, certificates, private keys, or values returned by Git Credential Manager.
- Do not create commits, push, tag, edit a GitHub Release, or publish artifacts unless the user explicitly authorizes that action.
- The user has authorized installing ordinary Rust/Node/native prerequisites needed for in-scope development. Diagnose or install normal missing tooling instead of handing routine setup back to the user; still ask before unrelated or materially risky system changes.
- A source push is not a release. Follow [`docs/RELEASE.md`](docs/RELEASE.md) for versioning and five-platform-asset verification.
- When state changes, update `docs/CURRENT_STATE.md`; when an accepted design changes, update `docs/DECISIONS.md`; when work is completed, remove it from `docs/TODO.md`.
