# Architecture

This document contains stable architecture knowledge. Current progress and verification belong in [`CURRENT_STATE.md`](CURRENT_STATE.md).

## Goal and stack

Crypto Top is a tiny, always-on-top watchlist for real-USD cryptocurrency spot markets and explicitly labeled stock-related USDT perpetuals on Windows, macOS, and Linux. It uses:

- Tauri 2 and Rust for the native window, tray, platform behavior, permissions, and bundles.
- Static HTML/CSS plus strict TypeScript modules from `src/`; `tsc` emits browser-native ES modules and the frontend script copies/injects local static assets into ignored `dist/`. There is no frontend framework, server, or bundler.
- Public WebSocket and REST endpoints for market data; no user API key or backend service.
- Node's built-in test runner with `tsx` for TypeScript tests, plus Rust unit tests for native layout behavior.

## Runtime data flow

```text
Coinbase USD products + Bybit/Gate stock contracts ── search catalog ─┐
Bitstamp markets ── exact USD-spot backup mappings ───────────────────┼─ watchlist model/localStorage
                                                                       │
Coinbase/Kraken/Bitstamp/Bitfinex WebSockets ─────────────────────────┤
Bybit/Gate perpetual WebSockets ──────────────────────────────────────┤
Coinbase/Bybit/Gate current-price REST fallback ──────────────────────┼─ PriceFeed
Exchange-specific same-source UTC-open REST/WS ───────────────────────┘      │
                                                                              ▼
                                                           dist/main.js batched DOM rendering

Tauri/Rust ── monitor/about windows/tray/always-on-top/dynamic height/minimal IPC commands
```

Detailed provider semantics and failover rules live in [`MARKET_DATA.md`](MARKET_DATA.md).

## Module ownership

| Path | Responsibility |
| --- | --- |
| `src/index.html` | Static title bar, accessible sortable quote-row template/status, screen-bounded vertical-resize handle, temporary watchlist-management panel |
| `src/styles.css` | Fixed 208px visual budget, row/manager layouts, reorder/drop indicators, overflow-aware scrolling, resize affordance, colors, reduced-motion behavior |
| `src/about.html` / `src/about.css` / `src/about.ts` | Compact local About view, exact repository opener interaction, and accessible presentation |
| `src/main.ts` | UI state, DOM construction, delegated quote-row drag/keyboard ordering, approximately 30 FPS render coalescing, overflow state, coalesced resize requests, watchlist interactions, native command calls |
| `src/watchlist.ts` | Product model and types, BTC/ETH defaults, uncapped validated localStorage, independent Coinbase/Bybit/Gate catalog discovery/search, exact backup mappings |
| `src/price-feed.ts` | Provider/parser/socket/state types, resilient sockets, source selection, REST fallback, UTC-open lifecycle, stale/status state |
| `src/price-format.ts` | Compact dollar-denominated numeric formatting across large and very small USD/USDT quotes |
| `scripts/frontend.ts` | Clean ES-module emit/watch, static-page/license copying, canonical icon copying, and About version injection |
| `tsconfig*.json` | Shared strict rules plus application, test/tooling, and ES2025 emission/type-library boundaries |
| `src-tauri/src/lib.rs` | Native monitor/About window behavior, top-right placement, tray/menu routing, hide-vs-quit semantics, dynamic height commands |
| `src-tauri/tauri.conf.json` | Main monitor and hidden About window envelopes, CSP, application metadata, bundle metadata |
| `src-tauri/tauri.*.conf.json` | Platform bundle targets and macOS minimum version |
| `src-tauri/capabilities/*.json` and `permissions/` | Main-window commands plus an isolated exact-URL About opener permission |
| `tests/` | Parser/state regression tests plus static UI/CSP constraints |
| `.github/workflows/build-desktop.yml` | Four-runner build matrix, macOS 12 bundle/deployment gate, and tag-driven five-asset release job |

## Core models and interfaces

### Product

The unified key is semantic rather than a guessed exchange symbol:

- USD spot: Coinbase-style ID such as `BTC-USD`.
- Stock-related USDT perpetual: canonical ID such as `MU-USDT-PERP`, displayed as `MU.P`.

Relevant fields are `id`, `symbol`, `name`, `fixed`, exact optional provider symbols (`krakenSymbol`, `bitstampSymbol`, `bitfinexSymbol`, `bybitSymbol`, `gateSymbol`), and semantic fields (`quoteCurrency`, `marketType`, `assetClass`). A missing provider symbol means that source must not be subscribed or queried for that product. Bybit's official `underlyingTicker` and Gate's official contract base form canonical stock-related IDs; provider symbols themselves are never reconstructed. BTC/ETH are fixed against deletion but remain reorderable like every other quote row; other products are removable.

`src/watchlist.ts` owns normalization, pure reordering, and persistence. Storage key `crypto-top.watchlist.v1` is versioned, validated, deduplicated, has no application-level item-count cap, preserves explicit row order including BTC/ETH, and fails safely to canonical BTC/ETH defaults when either fixed product is missing.

### PriceFeed

`new PriceFeed({ products, WebSocketImpl?, fetchImpl?, now? })` constructs provider connections. The important public methods are:

- `start()` / `stop()` for lifecycle.
- `subscribe(listener)` for state updates.
- `setProducts(products)` for a safe dynamic rebuild while preserving compatible quotes/opens.
- `reconnectAll()` for online/visibility recovery.
- `getState()` for `{ status, prices, sources, lastUpdateAt }`.

Quotes carry an `asset` product ID, `price`, `source`, `marketSource`, `transport`, `exchangeAt`, and `receivedAt`. `marketSource` associates each REST fallback with its exchange (`coinbase`, `bybit`, or `gate`) for same-source UTC calculations.

Product changes increment a revision, abort obsolete REST work, and prevent removed-product requests from writing back.

## UI and native boundary

- The main monitor width is fixed at `208px`; it is not generally OS-resizable, remains undecorated/always-on-top, and is skipped from taskbar/Dock according to platform.
- Quote view automatic heights are `92/125/158px` for 2/3/4+ rows. With five or more products, a bottom handle can request a quote-only height from the automatic minimum up to the lesser of selected content and the current monitor's remaining work-area height; there is no eight-row viewport ceiling. Rows beyond the available screen height remain accessible through internal scrolling.
- Management view replaces the quote area temporarily and is capped at `170px`; it does not add permanent controls to quote rows.
- Every quote row is HTML5-draggable and keyboard-sortable with `Alt+ArrowUp/Down`. Drop position uses the target row midpoint, edge dragging scrolls long lists, successful changes are persisted without calling `PriceFeed.setProducts`, and focus/live-region feedback follows the moved row. Normal Arrow keys retain quote scrolling.
- Normal layout calls pass the complete selected row count, a management-saturated item count, and management mode. The resize handle passes the complete row count plus a requested height; Rust calculates content height with saturating arithmetic, clamps it to the space from the window's current top to the current monitor work-area bottom, retains the session quote height across temporary management mode, and always sets the width to `208px`. The main window has no static `maxHeight`; this narrow native command remains its only resize path.
- The decorated `320×280px` About window is pre-created hidden, centered when requested, fixed-size, skipped from taskbar/Dock, and reused as a single instance. Closing it hides it rather than affecting the process.
- About uses local HTML/CSS plus one small local module. Its version is injected from `tauri.conf.json`, its icon is copied from canonical `assets/app-icon.svg`, and its GitHub icon calls the native opener for one exact repository URL. It shows only a concise GPL notice; the complete license is still copied to `dist/LICENSE.txt` and configured as Tauri's bundle license file.
- The five exposed commands are `minimize_window`, `close_window`, `ensure_always_on_top`, `set_monitor_layout`, and the quote-only `resize_monitor_height`, scoped only to the main window. Both close/minimize commands hide; process exit is tray-only.
- Windows/macOS users may restore by left-clicking the tray icon; the cross-platform reliable contract is the tray menu's Show/Hide/About/Quit actions, so Linux behavior must not depend on left-click events.
- The window starts near the primary monitor's top-right work area and is not automatically repositioned after user movement or height changes.
- Always-on-top is deliberately reasserted during initial setup, window focus, application resume, and from the frontend every 10 seconds. These calls are resilience layers, not accidental duplication.
- `data-tauri-drag-region="deep"` is required so nested title-bar text remains draggable.
- The main window sets `dragDropEnabled: false` because Tauri's native file-drop handler otherwise intercepts frontend HTML5 drag events on Windows. Page-level guards prevent external file/text drops from navigating the WebView; the About window does not need this setting.

## Security and compatibility boundaries

- `freezePrototype` is enabled.
- CSP lists only the exact HTTPS/WSS origins currently used; there are no wildcard data origins.
- Tauri capabilities expose default/start-dragging window permissions plus the five custom commands only to `main`. The frontend has no general set-size or native resize-drag permission; `resize_monitor_height` fixes width and clamps quote height to content and the current screen work area in Rust. A separate `about` capability exposes only `opener:allow-open-url` for the exact canonical repository URL; it has no wildcard/default URL scope or main-window commands.
- Remote names/text are inserted through `textContent`, text nodes, or attributes rather than HTML injection.
- macOS minimum is 12.0. TypeScript emits the fixed `ES2025` language target with `ES2025` library declarations while retaining native `ES2022` modules. This is not a polyfill guarantee: macOS supplies WKWebView and Linux supplies WebKitGTK, so an installed system WebView may lag newer syntax or APIs admitted by the compiler. Review each newly used feature, provide a local fallback where appropriate, and verify release candidates on the minimum supported macOS plus representative Linux systems instead of assuming the TypeScript target proves runtime support.
- Credentials, private keys, signing material, and GitHub tokens never belong in the repository.

## Platform boundaries

Always-on-top cannot override UAC/security desktop, lock screens, exclusive fullscreen applications, or every Wayland compositor. Linux tray behavior depends on desktop StatusNotifier/AppIndicator support. These are OS boundaries, not reasons to weaken the architecture.
