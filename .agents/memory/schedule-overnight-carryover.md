---
name: Schedule live-first overnight carryover
description: Why live-now detection on a per-day schedule grid must check yesterday's midnight-crossing slots
---
Rule: a slot listed under yesterday's dayOfWeek that crosses midnight (end <= start, or a null end whose implied 60-min run spills past 24:00) is still live in today's early hours. Same-day live checks alone miss it.

**Why:** architect review failed Task #294's "current slot first" requirement — a Sat 23:00–02:00 show was never shown live at 00:30 because liveNow only scanned today's bucket and isSlotLive truncates at midnight.

**How to apply:** keep the pure helpers (toMinutes/isSlotLive/isOvernightCarryoverLive) in lore's src/lib/scheduleLive.ts (unit-tested in test/scheduleLive.test.ts); when building any "on air now" bucket from a per-day grid, union today's live slots with yesterday's carryover slots.
