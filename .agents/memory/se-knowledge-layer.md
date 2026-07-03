---
name: Song Exploder is knowledge, not a picker
description: Architectural rule — SE and Wikipedia belong on the knowledge layer alongside lyrics, not treated as curated playlists/pickers in the UI.
---

# Song Exploder is knowledge, not a picker

## The rule
Song Exploder (and Wikipedia) are **knowledge** about a recording — parallel to time-synced lyrics, not parallel to editorial/blog/label pickers. They must never appear in the Curated section or as picker archive pages in the Lore UI.

**Why:** The distinction is source type. Pickers = humans curating what to listen to next (taste layer). Knowledge = facts about the song itself (identity layer). Song Exploder tells the story of a song; it doesn't recommend what to play.

## How it manifests in the UI
- `NowPlaying.tsx` uses an `artMode: "art" | "lyrics" | "exploder"` tri-state instead of a boolean `showLyrics`.
- A `Mic2` toggle button in the corner cluster appears only when the recording has an SE episode (`SEToggleBtn` inner component fetches `useGetRecordingSongExploder` and renders null if no episode).
- `SongExploderPanel` slides in below the album art exactly like `LyricView` — scrollable anchor timeline, active anchor highlighted by `progressMs`, episode link in header.
- No dismissable popup/signpost. Always-visible panel when open.

## What was removed
- `SongExploderSignpost` (fire-and-dismiss popup) — deleted.
- `SongExploderBadge` (pill below artist name linking to song page) — deleted; the corner toggle IS the badge.
- `artifacts/lore/test/songExploderSignpost.test.tsx` — deleted (tested popup behavior that's gone).

## The SE picker in DB
The `song-exploder` picker row (type=`series`) still exists as an implementation detail for resolving episodes to MBIDs via `persistPick`. It should NOT be surfaced in the Curated section (`CURATED_TYPES` in Home.tsx must not include `"series"`).
