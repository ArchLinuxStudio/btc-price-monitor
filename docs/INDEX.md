# Development Documentation Index

Start here instead of reading every document. Repository documentation is the persistent context for a new development thread.

## Document map

| Document | Stability | Read when… | Authority |
| --- | --- | --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Stable | Starting any substantial task | Agent workflow, core guardrails, standard commands |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Stable | Changing modules, native integration, UI structure, state flow, or security boundaries | Overall system architecture and module ownership |
| [`MARKET_DATA.md`](MARKET_DATA.md) | Stable/domain | Changing exchanges, parsers, failover, UTC change, product mappings, or network policy | Market-data semantics and provider behavior |
| [`DECISIONS.md`](DECISIONS.md) | Stable | A constraint seems odd, or an alternative design/framework/source is being reconsidered | Accepted decisions, user requirements, rejected alternatives, compatibility rules |
| [`RELEASE.md`](RELEASE.md) | Stable/operational | Building packages, changing versions/CI, tagging, or publishing | Release procedure, artifact names, and release-specific pitfalls |
| [`CURRENT_STATE.md`](CURRENT_STATE.md) | Volatile | Restoring the latest checkpoint or determining what just happened | Current objective, Git snapshot, verification evidence, and next action |
| [`TODO.md`](TODO.md) | Volatile | Choosing or scoping the next authorized task | Remaining executable work and completion criteria |
| [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) | Mixed | Diagnosing a known limitation, platform issue, API issue, or environment anomaly | Current bugs/limitations, workarounds, and investigation history |
| [`../README.md`](../README.md) | User-facing | Installing, running, or understanding public features | End-user behavior and public data-source overview |

## Selective reading routes

- UI/layout change: `CURRENT_STATE.md` → `ARCHITECTURE.md` → compact-UI entries in `DECISIONS.md` → relevant UI tests.
- Exchange or price semantics: `CURRENT_STATE.md` → `MARKET_DATA.md` → relevant entries in `DECISIONS.md` → `src/price-feed.ts` tests.
- Watchlist/search/persistence: `CURRENT_STATE.md` → `ARCHITECTURE.md` → `src/watchlist.ts` and its tests.
- Tray/window/native behavior: `CURRENT_STATE.md` → `ARCHITECTURE.md` → relevant decisions → `src-tauri/src/lib.rs`.
- Build or publish: `CURRENT_STATE.md` → `RELEASE.md` → `KNOWN_ISSUES.md`.
- New feature proposal: `CURRENT_STATE.md` → `TODO.md` and `DECISIONS.md`; do not infer authorization from an optional idea.

## Single-source rules

- Exact dependency and package versions: `package.json`, lockfiles, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Exact current code behavior: source and tests. Documentation records intent and boundaries, not copied implementations.
- Current Git/verification snapshot: `CURRENT_STATE.md`, checked against live `git status` and rerun commands before relying on it.
- Release workflow mechanics: `.github/workflows/build-desktop.yml`; `RELEASE.md` explains how and why to operate it.
- Historical commits/releases: Git and GitHub, not a copied chronology in the docs.

`CODEX_CONTEXT.md` was retired during the 2026-08-22 checkpoint after its useful content was split into this system. Do not recreate another all-in-one thread transcript.
