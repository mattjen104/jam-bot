---
name: Spinitron public calendar schedules
description: Reliable, keyless ingestion rules for weekly schedules published through Spinitron calendar pages.
---

Spinitron’s public `/CALLSIGN/calendar` page does not include its show grid as visible HTML. Its inline calendar configuration points to `/CALLSIGN/calendar-feed`, which accepts `start` and `end` dates and returns show occurrences as JSON. This is separate from the authenticated Spinitron developer API.

**Why:** Treating the calendar HTML as ordinary page text produced “successful” empty schedules. Real pages also encode the feed path inside JavaScript as `\/...`, and Spinitron’s robots policy publishes a 10-second crawl delay.

**How to apply:** For strictly validated `spinitron.com/<station>/calendar` sources, decode only JavaScript-escaped slashes, require the feed to stay on the same origin and expected path, request one bounded week, and discard FullCalendar padding outside the exact `[start, end)` dates before deriving recurring weekdays. Preserve local wall-clock timestamp components and serialize real network requests at the published crawl delay.