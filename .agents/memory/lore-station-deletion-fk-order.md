---
name: Station removal FK order & rediscovery blocklist
description: How to permanently remove a station (or class of stations) from Lore without it reappearing or hitting an FK violation.
---

Deleting rows from `stations` fails with a foreign-key violation unless
dependents are cleared first. There is no `ON DELETE CASCADE` on these
references. Delete in this order:

1. `spins` where `station_id` matches
2. `shows` where `station_id` matches
3. `radio_browser_stations` where `station_id` matches (easy to miss —
   this table isn't part of the play-history spine, so it's not the
   first FK you think of, but it references `stations.id` too)
4. `station_quality` where `station_id` matches (another non-obvious
   child — discovered when `resolve-dedup-db.test.ts` hit a 23503 on
   teardown; must be cleared before step 5)
5. `segue_edges` where `station_id` matches (listKey-scoped adjacency
   built by the segue job)
6. `scraped_shows` where `station_id` matches (schedule-scraper weekly
   grid — a 23503 here appears only once a purged station's schedule
   was ever scraped, so it can surface long after the purge code ships)
7. `stations` itself

Other `stations.id` children are safe: `listens` and
`embed_resolution_metrics` use `onDelete: "set null"`; `list_sources`
and `song_bottles`/`listen_sessions` reference stations but are not
touched by radio_browser purges (curated/user rows, not discovered
stations). Re-audit this list when adding a new table with a
`station_id` FK — the purge in `radio-browser.ts` must be extended in
the same commit.

**Why:** the discovery pipeline (radio-browser.info ingestion) keeps its
own bookkeeping row per discovered candidate in `radio_browser_stations`,
separate from `spins`/`shows`. A delete that only clears the play-history
tables still fails on this one.

**Rediscovery:** deleting the rows is not enough on its own — the
radio-browser.info discovery worker (`artifacts/api-server/src/lore/radio-browser.ts`)
re-adds anything matching its genre-tag whitelist (`RADIO_BROWSER_GENRE_WHITELIST`)
regardless of branding. A "bad" station (e.g. spammy/ad-heavy branded
aggregator) can slip in under a legitimate tag like "world" or "ambient".
To permanently exclude a station or brand family, add a case-insensitive
name substring to `RADIO_BROWSER_NAME_BLOCKLIST` in that same file —
checked in `filterStations` before bitrate/vote filtering, so it blocks
ingestion at the source rather than relying on a later purge pass.
