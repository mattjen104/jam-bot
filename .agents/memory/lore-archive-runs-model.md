---
name: Lore archive runs model
description: How ghost-radio "runs" are identified and replayed — synthetic runId, grouping keys, honest gaps, replay mode.
---

# Archive runs have no table — runId is synthetic

A "run" is a derived grouping, never a stored row:
- Station runs group spins by `(stationId, showId, UTC day)`; picker runs group picks by `(pickerId, sourceUrl)`.
- `runId = min(id)` of the group's rows (the anchor). Detail endpoints look up the anchor row and re-derive the group from its keys. `showId` can be NULL — the reconstruction must branch null-safely or grouped shows leak into each other.

**Why:** avoids a runs table + backfill migration; any re-ingest keeps runIds stable as long as the anchor row survives. Consequence: deleting/re-ingesting the oldest row of a group changes its runId — don't treat runIds as permanent citations, the `sourceUrl` is the citation.

**How to apply:** any new run-shaped grouping (e.g. blog posts, future adapters) should reuse this pattern: group key + min(id) anchor + anchor-reconstruction detail endpoint.

# Replay is a player mode, not a new player

`PlayerProvider` has `mode: "trail" | "replay"`. `startReplay(seeds, label)` swaps in a fixed queue; lookahead/segue generation is disabled in replay; end-of-queue = end of ride. Unresolved archive tracks are shown as dashed "honest gap" rows and **excluded from the replay queue** — never fabricate or fuzzy-match to fill a gap.

# Deep backfill loop-guard

KEXP backfill walks backward via `airdate_before`, one slice per tick, cursor persisted per slice (resumable). When a boundary page is all-duplicates (oldest == cursor), nudge the cursor 1s older or the walk wedges forever. Backfill ingestion must never touch the live `lastSeenCursor` and skips link enrichment fan-out.
