---
name: Lore E2E run discovery
description: Why archive-run E2E tests must discover run IDs via the API, and how to get Playwright browsers in a fresh env.
---

# Lore E2E: discover run IDs, never hardcode them

Archive run IDs (station and picker) are **derived groupings** — `runId = min(spin/pick id)` per run — so they drift between environments whenever data is re-ingested. Hardcoded run IDs in E2E specs go stale silently (page 404s → test fails on an unrelated assertion like `h1` visibility).

**Why:** the fallback-notice suite originally hardcoded a station run ID that didn't exist in a fresh environment's DB; 3 tests failed with misleading timeouts.

**How to apply:** in Playwright specs, resolve run IDs at runtime through the public API and memoize:
- Station run: `GET /api/recordings/:mbid/spins` → first spin with `runId != null` (anchor on a stable recording MBID).
- Picker run: `GET /api/pickers/:handle/archive` → first run with `resolvedCount > 0`, then `GET /api/archive/picker-runs/:runId` for a resolved MBID (anchor on a stable picker handle).
Stable anchors = MBIDs and handles; unstable = run IDs.

# Playwright in a fresh environment

- Browsers are cached workspace-locally (`.cache/ms-playwright`), so a fresh/isolated environment needs `npx playwright install chromium` once (downloads headless shell; works fine on the Nix base).
- The config's `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`/`NIX_CHROMIUM_PATH` overrides put `executablePath` at the `use` top level, which Playwright test does NOT honor (it belongs under `launchOptions`) — the system-chromium fallback path has never actually worked; installing browsers is the reliable route.
- Run via `cd artifacts/lore && npx playwright test ...`; `pnpm --filter @workspace/lore exec playwright` fails if deps weren't installed (`pnpm install --filter @workspace/lore` first).
