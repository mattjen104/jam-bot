---
name: Library artist-to-album navigation
description: Product rule for presenting a track-backed library through artist and album navigation.
---

The library remains track-backed: radio keeps and imported songs stay as individual saved items with their provenance and timestamps. Artist mode derives only from kept material and case-insensitively deduplicates those grounded artist names.

**Why:** Artist mode is a compact navigation index, not another track presentation. Seed-only taste inputs must not inflate Library ownership, and album playback must never guess sequence from bridge-row insertion order.

**How to apply:** Sort Artist mode A–Z. Render one non-expanding row per kept artist with inline album/song counts; link only verified artist MBIDs. Artist pages may show large grounded album art, but album queues must use the exact release-group MBID and MusicBrainz medium/track positions. If canonical order cannot be fetched, disable playback explicitly rather than falling back to serial bridge IDs. Removing an artist from active tuning/library membership must not delete underlying saved tracks.