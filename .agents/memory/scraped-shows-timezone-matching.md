---
name: Scraped-show timezone & slot matching
description: Timezone inference gotchas and the canonical overnight slot-match SQL pattern for scraped_shows
---

- RadioBrowser stations store FULL country names ("The United States Of America", "Bosnia And Herzegovina"), not ISO codes — `inferTimezone` must normalize via `normalizeCountry()` first or every inference silently misses. City is almost always empty for RB stations, so US stations stay null and need the manual admin PATCH `/admin/stations/:id/timezone`.
- Overnight slot matching (end_time <= start_time, e.g. 22:00–02:00) has ONE canonical SQL pattern, now in three places that must stay in sync: the crossing scorer's `currently_airing` CTE (socket-leases.ts), `stampSpinShowIds`, and `lookupScrapedShowId` (scraped-shows-sync.ts). Shape: same-day non-wrap OR same-day wrap-start OR yesterday-DOW carryover before end_time.
- Any `DISTINCT ON` / `LIMIT 1` slot match MUST carry an explicit ORDER BY (`start_time DESC, id`) — overlapping schedule rows otherwise pick nondeterministically and the null-only stamper makes the wrong pick sticky forever.
- Boot order matters: timezone backfill must run BEFORE `syncScrapedShows` or the spin stamper sees null zones that boot.

**Why:** 70/72 schedule-bearing stations had null timezones purely from the country-name mismatch; fixing normalization backfilled 422 stations and stamped 1,754 spins at once.
