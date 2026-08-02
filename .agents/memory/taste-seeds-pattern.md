---
name: Taste seeds — zero-friction onboarding pattern
description: How artist-name seeds flow through the crossing pipeline and what cache surfaces they touch.
---

## The pattern

`taste_seeds(id, user_id, artist_name, created_at)` — per-session table (FK → lore_users CASCADE).  
Seeds are lower-trimmed before INSERT; uniqueness enforced by `taste_seeds_user_artist_uq` index on (user_id, artist_name).

PUT `/api/me/taste-seeds` atomically replaces the full list then calls:
- `bustCrossingsCache(userId)` — evicts L1 Map + deletes from `crossings_cache` table
- `bustLibraryHitCache(userId)` — evicts the in-process `libraryHitCache` Map (no Postgres layer here)

**Why:** Seeds flow through two independent pipelines:
1. `crossings.ts` GET query — `userSeedArtists` subquery unioned into `artistMatch` (same path as `userSoftArtists` from Spotify imports)
2. `library-hits.ts` `buildLibraryHitContext()` — parallel query #5 merges seed lower-names into `softArtistNames` for SSE `isArtistHit` flags

## Client side

- `useMyTasteSeeds()` / `useSetTasteSeeds()` in `meHooks.ts` — follows same hand-crafted fetch pattern as `useMyDialCrossings`
- `useSetTasteSeeds` on success: invalidates `ME_DIAL_CROSSINGS_KEY(today)` + `ME_PICKER_NAMES_KEY` so Zone 1 refreshes without reload
- `hasSeeds` flows: `picker-names` response → `useMyPickerNames` → `useDialData` → `DialView`

## Zone 1 state machine (no library)

1. `seeds.length === 0` → full `SeedPrompt` (input + 8 suggestion chips + Spotify secondary CTA)
2. `seeds.length > 0`, Zone 1 empty → `z1-placeholder--seeded` (chips + matching skeleton + import upgrade CTA)
3. `seeds.length > 0`, Zone 1 has rows → `SeedBar` above rows (compact chip strip + "+ artist" inline input + "Import library →")

## Cache bust order matters

Always bust crossings BEFORE library-hits (or in parallel) — they are independent caches with no shared lock.

## DB push note

`drizzle-kit push` (even `push-force`) gets stuck on an interactive prompt about `lore_users_device_key_unique` constraint drift. Bypass by running the `CREATE TABLE IF NOT EXISTS` SQL directly via node-pg, then `npx tsc -p tsconfig.json` to rebuild lib/db dist.
