---
name: Rotating schedule honesty
description: How to represent official station calendars that overlap or rotate without fabricating recurrence.
---

If an official dated calendar contains overlapping events, preserve the whole requested window as date-specific schedule evidence. Do not select a winner or flatten any event in that conflicted window into the weekly grid. Conflict-free provider weeks can continue using recurring rows.

**Why:** Overlaps can represent alternating-week programs or genuine exceptions. A weekday/time projection erases the date that makes both entries true and presents invented weekly recurrence to listeners.

**How to apply:** Keep dated exceptions separate from recurring schedule rows, replace both atomically on a successful scrape, and retain the source URL plus extraction method on every stored and returned row.