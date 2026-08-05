---
name: Crossings query performance
description: Why /api/me/crossings is slow and what the safe working configuration is.
---

## The rule
Keep `/api/me/crossings` as a **single bounded query** with a 180-day `scanCutoff`. Never run an unbounded (no `WHERE playedAt`) lifetime query — it causes a full sequential scan regardless of library size.

**Why:** The dev spins table has ~976k rows; 528k of those are within 30 days (radio monitoring runs continuously for hundreds of stations). An unbounded query ignores `spins_station_played_at_idx` entirely and takes 10–16 s even with zero library data. A 5-year bound also barely helps because the date range still covers nearly all rows. Only a tight window (≤ 180 days) produces a meaningful index-selective scan.

A two-query approach (30-day rolling + unbounded lifetime) was introduced by a task agent to decouple lifetime counts from the rolling window. It caused 10–16 s hangs that kept `crossingsLoading: true` indefinitely, making the radio screen appear blank (skeleton never resolves to content).

**How to apply:**
- Single query, `scanCutoff = 180 days`, all rolling + lifetime counts in one `SELECT` with FILTER clauses.
- `CROSSINGS_CACHE_TTL_MS = 30 min` (was 2 min). Crossings change slowly; stale-by-30-min is fine and means the cold compute fires at most once per half-hour per user.
- If future work needs true unbounded lifetime counts, it must go through a pre-computed/materialized path (background job writing to a separate table), never a hot-path query against the raw spins table.
- Zone1Placeholder correctly shows "Finding which stations are playing your music…" + skeleton rows while crossings load, so a slow cold compute degrades gracefully — it does NOT produce a blank screen unless the request hangs forever (unbounded query).
