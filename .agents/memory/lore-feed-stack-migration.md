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

## Home All-feed ordering

The home Feed’s **All** tab is a single real-time station stream, not a set of
category summaries. It includes every station in the selected categories,
sorts the usable live observations newest-first, and fills a four-row grid
top-to-bottom before continuing into the next horizontally scrollable column.
Quiet or metadata-less stations follow the live observations.

**Why:** category cards turned the overview into a reduced editorial index,
making it hard to scan the actual current radio landscape. The column flow
keeps the newest item at top-left while exposing eight stations in the initial
two-column view.

**How to apply:** retain flat ordering in All even when category tabs or
membership controls evolve. Category tabs may show category-specific lists;
they must not reintroduce grouping into All. Preserve the four-items-per-column
DOM sequence so CSS column flow remains deterministic.

The live UI freshness timestamp can be deliberately restamped to the current
time for every REST row. All-feed ordering must use the separately preserved
source track-start timestamp instead.

**Why:** comparing the restamped display clock ties every card and silently
falls back to alphabetical ordering, even while current tracks are available.

**How to apply:** retain an honest source-time field whenever a consumer needs
cross-station recency ordering; only use the restamped time for live/fresh UI.

## Landed (fanned Library crate)
- Every reachable `/library` lens (`?lens=recent|artists|…` included) renders
  the same fanned Kept/Added crate rather than switching to a legacy dashboard
  or flat list. Deep-linked lenses retain their lens controls above the crate;
  the crate owns sorting, unopened filtering, import access, release/artist
  navigation, caught-track playback, and removed-item actions.
- The default crate keeps the operational Add-music entry and the connected
  Spotify sync bar. An empty deep-linked lens offers “Show all” in place,
  while an empty default crate offers Add music and Open the dial.
- Added artists remain bounded initially, but expand in place to reveal the
  complete list; they never hand off to a separate Index route.

**Why:** the old split made the same Library URL feel like unrelated products
and left Added artists at a dead end. A single crate preserves the useful
controls while making every entry path visually and behaviorally consistent.

**How to apply:** keep new Library entry paths inside the crate read model.
Preserve explicit provenance/date/attendance wording, and never merge
automatic Heard attendance into intentional keeps.

## Still separate tasks (do not duplicate in spike task)
- Expand-then-keep Feed row behavior + byline (own task)
- Album Investigation / entity sheets + route collapse (own tasks)

## Test/e2e touchpoints when changing row grammar or nav labels
- test/slimSectionNav, sleepMode, eraGenreMode (label text)
- test/frontDoorRow, dialViewBareTrack, dialReasonR6R7 (separator/aria-label)
- e2e/ntsOnAirBadge + cornerNavTappability match `Some Artist · NTS 1` by
  accessible name — the row aria-label must keep the dot format.
