# Architecture

This document contains stable architecture knowledge. Current progress and verification belong in [`CURRENT_STATE.md`](CURRENT_STATE.md).

## Goal and stack

Crypto Top is a tiny, always-on-top, real-USD cryptocurrency watchlist for Windows, macOS, and Linux. It uses:

- Tauri 2 and Rust for the native window, tray, platform behavior, permissions, and bundles.
- Static HTML/CSS plus strict TypeScript modules from `src/`; `tsc` emits browser-native ES modules and copies static assets to ignored `dist/`. There is no frontend framework, server, or bundler.
- Public WebSocket and REST endpoints for market data; no user API key or backend service.
- Node's built-in test runner with `tsx` for TypeScript tests, plus Rust unit tests for native layout behavior.

## Runtime data flow

```text
Coinbase products/currencies ── search catalog ─┐
Bitstamp markets ── exact backup mappings ─────┼─ watchlist model/localStorage
                                                │
Coinbase/Kraken/Bitstamp/Bitfinex WebSockets ──┤
Coinbase REST current-price fallback ──────────┼─ PriceFeed ── selected quote + same-source UTC open
Exchange-specific UTC-open REST/WS ────────────┘                          │
                                                                           ▼
                                                        dist/main.js batched DOM rendering

Tauri/Rust ── window/tray/always-on-top/dynamic height/minimal IPC commands
```

Detailed provider semantics and failover rules live in [`MARKET_DATA.md`](MARKET_DATA.md).

## Module ownership

| Path | Responsibility |
| --- | --- |
| `src/index.html` | Static title bar, quote-row template, temporary watchlist-management panel, accessible labels |
| `src/styles.css` | Fixed 208px visual budget, row/manager layouts, scrolling, colors, reduced-motion behavior |
| `src/main.ts` | UI state, DOM construction, approximately 30 FPS render coalescing, watchlist interactions, native command calls |
| `src/watchlist.ts` | Product model and types, BTC/ETH defaults, eight-product cap, validated localStorage, Coinbase catalog/search, exact backup mappings |
| `src/price-feed.ts` | Provider/parser/socket/state types, resilient sockets, source selection, REST fallback, UTC-open lifecycle, stale/status state |
| `src/price-format.ts` | Compact USD formatting across large and very small prices |
| `scripts/frontend.ts` | Clean ES-module emit/watch and verbatim static-asset copying from `src/` to ignored `dist/` |
| `tsconfig*.json` | Shared strict rules plus application, test/tooling, and ES2019 emission boundaries |
| `src-tauri/src/lib.rs` | Native window behavior, top-right placement, tray/menu, hide-vs-quit semantics, dynamic height commands |
| `src-tauri/tauri.conf.json` | Window envelope, CSP, application metadata, bundle metadata |
| `src-tauri/tauri.*.conf.json` | Platform bundle targets and macOS minimum version |
| `src-tauri/capabilities/main.json` and `permissions/` | Minimal frontend-to-native permission surface |
| `tests/` | Parser/state regression tests plus static UI/CSP constraints |
| `.github/workflows/build-desktop.yml` | Four-runner build matrix and tag-driven five-asset release job |

## Core models and interfaces

### Product

The unified key is the Coinbase-style product ID, for example `BTC-USD`.

Relevant fields are `id`, `symbol`, `name`, `fixed`, and optional exact source symbols (`krakenSymbol`, `bitstampSymbol`, `bitfinexSymbol`). A missing source symbol means that provider must not be subscribed for that product. BTC/ETH are fixed; other products are removable.

`src/watchlist.ts` owns normalization and persistence. Storage key `crypto-top.watchlist.v1` is versioned, validated, deduplicated, capped, and fails safely to defaults.

### PriceFeed

`new PriceFeed({ products, WebSocketImpl?, fetchImpl?, now? })` constructs provider connections. The important public methods are:

- `start()` / `stop()` for lifecycle.
- `subscribe(listener)` for state updates.
- `setProducts(products)` for a safe dynamic rebuild while preserving compatible quotes/opens.
- `reconnectAll()` for online/visibility recovery.
- `getState()` for `{ status, prices, sources, lastUpdateAt }`.

Quotes carry an `asset` product ID, `price`, `source`, `marketSource`, `transport`, `exchangeAt`, and `receivedAt`. `marketSource` keeps Coinbase REST associated with Coinbase for same-source UTC calculations.

Product changes increment a revision, abort obsolete REST work, and prevent removed-product requests from writing back.

## UI and native boundary

- Window width is fixed at `208px`; it is non-resizable, undecorated, always-on-top, and skipped from taskbar/Dock according to platform.
- Quote view heights are `92/125/158px` for 2/3/4+ rows. More than four products scroll inside the quote area.
- Management view replaces the quote area temporarily and is capped at `170px`; it does not add permanent controls to quote rows.
- The frontend passes only row count, management mode, and item count. Rust computes/clamps height and keeps width fixed.
- The four exposed commands are `minimize_window`, `close_window`, `ensure_always_on_top`, and `set_monitor_layout`. Both close/minimize commands hide; process exit is tray-only.
- Windows/macOS users may restore by left-clicking the tray icon; the cross-platform reliable contract is the tray menu's Show/Hide/Quit actions, so Linux behavior must not depend on left-click events.
- The window starts near the primary monitor's top-right work area and is not automatically repositioned after user movement or height changes.
- Always-on-top is deliberately reasserted during initial setup, window focus, application resume, and from the frontend every 10 seconds. These calls are resilience layers, not accidental duplication.
- `data-tauri-drag-region="deep"` is required so nested title-bar text remains draggable.

## Security and compatibility boundaries

- `freezePrototype` is enabled.
- CSP lists only the exact HTTPS/WSS origins currently used; there are no wildcard data origins.
- Tauri capabilities expose only default/start-dragging window permissions plus the four custom commands.
- Remote names/text are inserted through `textContent`, text nodes, or attributes rather than HTML injection.
- macOS minimum is 10.15. TypeScript emits ES2019 syntax, and frontend runtime APIs must remain supported by its older WKWebView (for example, use `Object.prototype.hasOwnProperty.call`, not `Object.hasOwn`).
- Credentials, private keys, signing material, and GitHub tokens never belong in the repository.

## Platform boundaries

Always-on-top cannot override UAC/security desktop, lock screens, exclusive fullscreen applications, or every Wayland compositor. Linux tray behavior depends on desktop StatusNotifier/AppIndicator support. These are OS boundaries, not reasons to weaken the architecture.
