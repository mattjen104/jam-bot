---
name: Radio attribution ladder
description: Sort and reason-sentence logic for the front-door live radio list; key design decisions and data sources.
---

# Radio front-door attribution ladder

## The ladder (implemented rungs)

| Rung | Condition | Sentence |
|---|---|---|
| 1 CROSSING | `show.currentTrack.isLibraryHit` | `◆ playing X — in your library` |
| 2 THIS SET | `show.crossings > 0` | `N of yours already this set` |
| 6 ON AIR | `show.djName` != null, no crossings | `on air · Xh Ym into the set` |
| 7 STATION | no djName, `ds.crossings > 0` | `N of yours today — no selector listed` |
| 0 DARK | nothing | `on air · Lore can't see who's playing` |

Rungs 3 (ARTIST), 4 (SCENE), 5 (CORROBORATION) are deferred — need new data.

## Sort order

1. Pinned stations first
2. Live crossing (rung 1) floats to top
3. Attribution tier: `show.djName != null` outranks null outright
4. Within attributed: `ovByName.get(show.djName) ?? 0` desc, then rung asc
5. Within unattributed: `ds.crossings` desc

`ovByName: Map<string, number>` comes from `GET /api/me/overlaps/selectors` (unauthenticated → empty map, sorts gracefully).

## Data sources

- `show.crossings` — set-level crossings (spins this show that match library), today-scoped **only** (see task #660 to widen)
- `ds.crossings` — station-level (sum of non-future show crossings today)
- `show.currentTrack.isLibraryHit` — exact-MBID match (see task #658 to widen to release-group)
- `ovByName` keyed by **djName** (not handle) — this is the only selector identifier available on `DialShow`

## Component structure (DialView.tsx)

- `intoSet(startedAt: string): string` — pure, computes "Xh Ym into the set"
- `reason(show, stationCrossings): ReasonResult` — pure, no hooks, returns `{r, cls, text}`
- `LiveShowRow` — stateless component, one per live station in "all" level
- `sortedLiveShows` useMemo — depends on `stations`, `pins`, `ovByName`
- Offline tier still uses `StationLane` rows unchanged

## Selectors page (Selectors.tsx)

- `RadioDjCard` now receives `sharedCount?: number` from `useMyOverlapSelectors()`
- `UnifiedSelector` has `sharedCount?: number` field
- `SelectorCard` renders the prose sentence only when `kind === 'dj' && sharedCount !== undefined`
- "has played **N** of your records" / "hasn't played anything of yours yet"
- `selectorSharedByHandle: Map<handle, count>` built from `useMyOverlapSelectors()` in the Selectors page

**Why:** The Selectors surface is about history (absolute count makes sense); the Radio surface is about the present moment (reason sentences only, no history count shown on rows).
