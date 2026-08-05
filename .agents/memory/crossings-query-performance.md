---
name: Crossings query performance
description: Why /api/me/crossings is slow and what the safe working configuration is.
---

## The rule
Keep `/api/me/crossings` as a **single bounded query** with a 180-day `scanCutoff`. Never run an unbounded (no `WHERE playedAt`) lifetime query — it causes a full sequential scan regardless of library size.

**Why:** The dev spins table has ~976k rows; 528k of those are within 30 days (radio monitoring runs continuously for hundreds of stations). An unbounded query ignores `spins_station_played_at_idx` entirely and takes 10–16 s even with zero library data. A 5-year bound also barely helps because the date range still covers nearly all rows. Only a tight window (≤ 180 days) produces a meaningful index-selective scan.

A two-query approach (30-day rolling + unbounded lifetime) was introduced by a task agent to decouple lifetime counts from the rolling window. It caused 10–16 s hangs that kept `crossingsLoading: true` indefinitely, making the radio screen appear blank (skeleton never resolves to content).

## Lifetime counts: mbid-driven, never date-driven
Lifetime crossings must include spins of any age, but an unbounded date scan is 10–16 s. Solution: drive a separate lifetime query by the user's relevant recording MBIDs (`spins.mbid IN (lib ∪ rg-widened ∪ artist-matched recordings)`) — Postgres nested-loops `spins_mbid_played_at_idx` per MBID, ~tens of ms regardless of spins-table growth. Rolling windows stay on the 180-day bounded scan; merge the two result sets by stationSlug (a station may exist in only one set).

## Merge-splice hazard
A task merge once spliced the **blended** handler's predicate names (`aggregateLibHit`, `spinCutoff`, `blendedWeekCutoff`…) into the **personal** `/api/me/crossings` route. Those variables only exist in the blended handler's scope, so every personal request threw a ReferenceError → 503 → `fetchOrNull` null → empty dial showing "None of your artists have played on a live station today." tsx does not typecheck, so this shipped silently. After any merge touching crossings.ts: curl the personal route (expect 200) and run `npx tsc --noEmit` in api-server.

**How to apply:**
- Single query, `scanCutoff = 180 days`, all rolling + lifetime counts in one `SELECT` with FILTER clauses.
- `CROSSINGS_CACHE_TTL_MS = 30 min` (was 2 min). Crossings change slowly; stale-by-30-min is fine and means the cold compute fires at most once per half-hour per user.
- If future work needs true unbounded lifetime counts, it must go through a pre-computed/materialized path (background job writing to a separate table), never a hot-path query against the raw spins table.
- Zone1Placeholder correctly shows "Finding which stations are playing your music…" + skeleton rows while crossings load, so a slow cold compute degrades gracefully — it does NOT produce a blank screen unless the request hangs forever (unbounded query).
