---
name: jam-bot Context tab = song blurb + queueable catalogue
description: Why the track card's "Genre & context" tab dropped the artist bio for a song-specific blurb + a navigable Spotify catalogue.
---

# Context tab: song blurb + queueable catalogue (no artist bio)

The track card's "Genre & context" tab no longer renders an artist-level
Wikipedia bio. It renders, in order: a song-specific blurb, the genre/Genius
line, then a navigable catalogue of the artist's top tracks (one-tap queue
buttons) + an album-queue dropdown.

**Why:** the old bio repeated the *same* artist paragraph on every track of an
album (e.g. identical Black Sabbath blurb each song) and often resolved the
wrong Wikipedia page (Eagles the band → Eagles the bird). The fix is to surface
only per-song facts + actionable Spotify navigation instead of a static artist
bio. The blurb is fact-grounded (album + top genre tag + writers/producers from
track knowledge) and never LLM-fabricated.

**How to apply:**
- The exported `contextBlocks` in `turntable/context.ts` is LEFT UNTOUCHED —
  `test/context.test.ts` locks its bio-rendering behavior. The tab rendering
  instead goes through `contextViewBlocks(state)` in `slack/track-card.ts`.
- Context tab is gated on context data OR catalogue data
  (`contextTabHasContent`), so it shows even when only the catalogue resolved.
- Slack actions block caps at 5 elements: top-track queue buttons are chunked
  5-per-row. `CATALOGUE_TRACK_BUTTONS=10` (two rows); Spotify's top-tracks
  endpoint returns ≤10. Album dropdown options capped well under Slack's 100.
- Queue action handlers (`CARD_QUEUE_ACTION_RE` single track, `CARD_ALBUM_ACTION`
  album) must mirror `CARD_SESSIONS_ACTION` exactly: per-user rate-limit,
  `withPlaybackLock` + `findActiveDevice` + `addToQueue`, `recordPendingRequest`
  + `recordUserRequest`, `PlaybackLockBusyError` → ephemeral. Resolve album
  track URIs (network) OUTSIDE the playback lock; only device lookup + the queue
  loop run inside it.
- Catalogue fetch is gated by `trackContextEnabled()` (it lives in the context
  tab), resolves artist id from `track.artistIds[0]` else name search, and
  `fetchArtistCatalogue` never throws (cache keyed by resolved artist id).
