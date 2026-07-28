---
name: Pending keeps — spin-based saves before resolution
description: How unresolved tracks are saved to a listener's library via pending_keeps table and the spinId field on NowPlaying.
---

## Rule
`library_items` requires an MBID FK. Unresolved spins use the `pending_keeps` table instead.
`spinId` is now part of every `NowPlaying` response so the frontend can act on unresolved tracks.

## How to apply
- `pending_keeps(user_id, spin_id, saved_at, promoted_at)` — created by `applyPendingKeepsMigration()` at boot.
- `POST /api/me/keep` accepts `{ spinId }` (no mbid). If the spin already has an mbid, it also writes to `library_items` and sets `promoted_at`.
- `DELETE /api/me/keep/spin/:spinId` — must be registered BEFORE `DELETE /api/me/keep/:mbid` or Express matches "spin" as an mbid.
- `GET /api/me/keep/pending-status?spinIds=…` → `{ savedSpinIds, pendingSpinIds }`.
- `toNowPlaying()` in `shared.ts` now includes `spinId` from the row; all three now-playing queries in `stations.ts` select `spinId: spinsTable.id`.
- `NowPlaying` interface hand-patched in BOTH `lib/api-client-react/src/generated/api.schemas.ts` (lore frontend reads this via project ref) AND `lib/api-zod/src/generated/types/nowPlaying.ts` (api-server/other consumers).
- After editing either generated file, rebuild the lib's dist: `cd lib/api-client-react && pnpm tsc -p tsconfig.json`.
- Frontend hooks: `useMySpinKeepStatus`, `useMutationKeepSpin`, `useMutationUnkeepSpin` in `meHooks.ts`.
- `KeepButton` and `WpKeep` both accept `mbid?` + `spinId?`; render nothing when both absent.
- Pending (not yet promoted) saves show amber "Saved ✓" styling; promoted shows lime "Kept ✓".

**Why:** `library_items.mbid` has a NOT NULL FK to `recordings`. Spins are never retroactively updated with an mbid after insert, so promotion happens synchronously at save time if the spin already resolved.
