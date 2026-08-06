---
name: Crossings query performance
description: Architecture for GET /api/me/crossings — 30-day bounded rolling query + mbid-driven lifetime query, never a full unbounded spins table scan on the hot path.
---

# Crossings query performance

## The rule
Lifetime crossing counts (lifetimeCrossings, lifetimeArtistCrossings) must never be computed by an unbounded `WHERE playedAt >=` clause (full spins table scan). Use an **mbid-driven** query instead: the WHERE clause filters by `spins.mbid IN (relevantMbids subquery)` so Postgres uses spins_mbid_played_at_idx per MBID (nested-loop semi-join), measuring in tens of milliseconds for library-sized sets regardless of table growth.

**Why:** An unbounded `SELECT … FROM spins` with no date filter is a sequential scan of millions of rows — 10–16 s observed in testing. Even a 365-day date bound caused the same problem at scale.

## Hot-path architecture (GET /api/me/crossings)

Two queries run in `Promise.all`:

1. **Bounded rolling query** — `WHERE playedAt >= scanCutoff (30 days)`: uses `spins_station_played_at_idx`; computes 24h / 7d / 30d rolling counts.
2. **Mbid-driven lifetime query** — `WHERE spins.mbid IN (relevantMbids)`: unbounded date range, fast via index; computes `lifetimeCrossings` and `lifetimeArtistCrossings` per station.

`relevantMbids` is a SQL UNION of:
- exact library MBIDs
- MBIDs sharing a primary release group with a library item
- any recording by a library artist (artistMbid or soft-name match via lowercase)

Results are **unioned by stationSlug** (not inner-joined) so stations absent from the 30-day window (lifetime-only) are never dropped. Rolling fields default to 0 for lifetime-only stations.

## Cache layers
- L1: in-process Map, 30-min TTL.
- L2: `crossings_cache` Postgres table (one row per user), 30-min TTL.
- `bustCrossingsCache` evicts both layers and calls `scheduleLifetimeCrossingsRefresh` (which writes to `lifetime_crossings_cache` as a belt-and-suspenders background table — not read by the hot path anymore, but kept for potential future use).

## Blended endpoint (GET /api/me/crossings/blended)
Uses the same two-query split as personal crossings:
1. **Bounded rolling query** — `WHERE playedAt >= blendedScanCutoff (30 days)`: computes 24h / 7d / 30d rolling counts + topArtistNamesRaw for all active opted-in users combined.
2. **Mbid-driven lifetime query** — `WHERE spins.mbid IN (blendedRelevantMbids)`: unbounded date range, fast via index; `blendedRelevantMbids` unions all active users' exact MBIDs + release-group expansions + artist matches.

Results are merged by stationSlug — same pattern as personal crossings. Cache TTL is 60 s (single shared L1/L2 entry, not per-user).

## How to apply
- New time-window fields (e.g. quarter-year) → add to the **bounded** rolling query only.
- New lifetime fields → add to the **mbid-driven** query only — never add a `WHERE playedAt >=` constraint to it.
- The `crossings_cache` L2 table is created by `applyCrossingsCacheMigration`; register new migrations in both `bootLore` (index.ts) and `globalSetup.ts`.
- `_testOnly_clearCrossingsCache` calls `bustCrossingsCache` — tests that need fresh DB data must call it before the request.
