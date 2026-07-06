---
name: library_items FK guard
description: Import worker must verify recordings table before inserting library_items or gets 23503 FK violation crashing the whole job
---

## Rule
Before inserting into `library_items`, always verify the resolved MBID exists in the `recordings` table. If it doesn't, skip that track silently (don't count it as resolved).

**Why:** `library_items.mbid` has a foreign key constraint to `recordings.mbid`. `resolveToMbid()` returns MBIDs from MusicBrainz that may not yet be present in our local `recordings` table (recordings only exist for tracks that have been spun on the dial). Attempting to insert without the guard causes a `23503` FK violation that crashes the entire import job with an unhandled error.

**How to apply:** Any code path that inserts into `library_items` with an externally-resolved MBID (imports, future sync jobs, etc.) must do a pre-check `SELECT mbid FROM recordings WHERE mbid = $1 LIMIT 1` and skip if not found.
