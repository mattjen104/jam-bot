---
name: Lore Feed/Stack unified interface migration
description: Status + conventions for the Radio→Keep→Albums interface migration (nav labels, compact row grammar, what remains in later tasks)
---

# Lore Feed/Stack unified interface migration

Spec lives at `artifacts/lore/INTERFACE_ARCHITECTURE.md` (approved); annotated
grayscale mockup in the mockup-sandbox under `lore-grayscale/`.

## Landed (first live slice)
- Primary nav labels are now **Feed** (`/`) and **Stack** (`/library`) in both
  SlimSectionNav variants (corner + bottom). Section ids/data-section hooks
  stay `lore`/`library` — CSS, gestures (five-tap sleep, long-press era/genre),
  and e2e locators key off those, so never rename the ids, only the labels.
- Compact Dial feed identity is left-to-right `artist · station` (flex,
  space-between) with a right-edge pulsing `· live` marker — replaced the
  centered three-column pipe grid.
- **Convention:** the dot separator renders ONLY when an artist exists; with an
  empty artist cell the station reads alone (tests assert `.fdrow__compact-separator`
  is null in that case). `liveProvenanceSummary().text` (aria-label) uses `·` too.

**Why:** row should read like a sentence — artist (the seeded thing) leads,
station is secondary context; centered pipe made the eye hunt mid-row.

**How to apply:** any new row surface (Stack rows, ghost rows, sheets) must use
the same grammar: `primary · secondary  [right-edge metadata]`, byline below on
expand. Album leads in the Stack; artist leads in the Feed.

## Still separate tasks (do not duplicate in spike task)
- Expand-then-keep Feed row behavior + byline (own task)
- Album-first Stack surface (own task)
- Album Investigation / entity sheets + route collapse (own tasks)

## Test/e2e touchpoints when changing row grammar or nav labels
- test/slimSectionNav, sleepMode, eraGenreMode (label text)
- test/frontDoorRow, dialViewBareTrack, dialReasonR6R7 (separator/aria-label)
- e2e/ntsOnAirBadge + cornerNavTappability match `Some Artist · NTS 1` by
  accessible name — the row aria-label must keep the dot format.
