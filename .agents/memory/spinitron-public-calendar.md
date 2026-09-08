---
name: Spinitron public calendar schedules
description: Reliable, keyless ingestion rules for weekly schedules published through Spinitron calendar pages.
---

Spinitron’s public `/CALLSIGN/calendar` page does not include its show grid as visible HTML. Its inline calendar configuration points to `/CALLSIGN/calendar-feed`, which accepts `start` and `end` dates and returns show occurrences as JSON. This is separate from the authenticated Spinitron developer API.

**Why:** Treating the calendar HTML as ordinary page text produced “successful” empty schedules. Real pages also encode the feed path inside JavaScript as `\/...`, and Spinitron’s robots policy publishes a 10-second crawl delay.

**How to apply:** For strictly validated `spinitron.com/<station>/calendar` sources, decode only JavaScript-escaped slashes, require the feed to stay on the same origin and expected path, request one bounded week, and discard FullCalendar padding outside the exact `[start, end)` dates before deriving recurring weekdays. Preserve local wall-clock timestamp components and serialize real network requests at the published crawl delay.

Treat public live metadata, public calendars, authenticated station history, and all-stations directory access as separate capabilities. A station-scoped key enables only that station's history; it never implies partner directory coverage. Without a key, report history as unavailable rather than as a successful empty archive.

Reviewed roster evidence must be applied before timezone backfill and schedule-to-spin stamping during boot. When a reviewed schedule URL replaces an older source, clear that source's attempt/failure backoff so the new public feed is eligible immediately.

**Why:** A valid schedule with no station timezone cannot be matched safely, and applying roster city evidence after the stamper creates a one-restart lag. Reusing the old URL's retry timestamp delays recovery even after the source is fixed.

**How to apply:** Propagate reviewed city/region and inferred timezone to existing roster rows without overwriting operator corrections; order boot as roster → timezone backfill → show sync/stamping.