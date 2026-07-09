---
name: Poller overlapping-tick races
description: Why identical consecutive spins got logged despite content-based dedup, and the fix.
---

## Symptom
Station chips (recent-track pills) showed the same song repeated several times in a row. Root cause was in the DB, not the display layer: `spins` had genuinely duplicate consecutive rows (byte-identical raw_title/raw_artist) for `nowPlaying`-style sources, spaced minutes apart.

## Root cause
`logSpinIfChanged` dedups by comparing the candidate's signature to the single most recent spin row for that station — a correct check in isolation. But `radio_browser_icy` polls every 30s, and if a tick's fetch is slow, the next `setInterval` fire can start before the previous tick's DB write commits. Both concurrent ticks read the same "last spin" (the old one), both see the candidate as different, both pass dedup, both insert.

This isn't visible from reading `logSpinIfChanged` alone — the bug is in the caller's concurrency, not the dedup logic itself. Duplicates were also intermittent (not every tick), consistent with an occasional race window rather than a broken comparison.

## Fix
Added a per-station `Set<number>` of in-flight station ids in `poller.ts`; `pollStation` now no-ops if a previous tick for that station hasn't finished, and clears itself in a `finally`. Skipping a tick is always safe — the next tick re-reads current now-playing state.

## Why this matters generally
Content-based dedup checks that read-then-write are inherently race-prone under concurrent callers. When a source has a tight poll interval relative to its fetch latency, add an explicit in-flight guard rather than trying to make the dedup query itself atomic.
