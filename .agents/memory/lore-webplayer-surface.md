---
name: Lore webplayer parallel surface
description: How the /player webplayer coexists with the classic Lore UI — routing shell, plain-JSON read-models, scoped theme.
---

# Lore webplayer parallel surface

- `/player` is a standalone surface: `Shell` in App.tsx routes it BARE (no AppLayout, no PlayerDock — the webplayer renders its own now-playing card off `usePlayer().radio`). Any new webplayer sub-route must stay under `/player/...` or it falls back to the classic shell.
- Server side uses plain-JSON read-model endpoints (`/api/player/*`, no OpenAPI/orval), mirroring the `/api/me/*` pattern; all work anonymously and enrich with library-overlap fields when a session exists. **Why:** the webplayer composes cross-table aggregates (on-air + overlap + lore counts) that don't fit the generated-client shape cheaply, and orval churn was avoided deliberately.
- Theme is scoped under a `.wp` wrapper class (`webplayer/wp.css` tokens); never leak `.wp` styles globally and never restyle classic components from webplayer code.
- **How to apply:** add new webplayer data needs as `/api/player/*` endpoints mounted before loreRouter's admin catch-all; keep frontend fetch hooks in `webplayer/hooks.ts`.
- Perf watch: `/player/onair` does selectDistinctOn over all spins per 30s poll — time-window it if station/spin volume grows.
