---
name: Library artist-to-album navigation
description: Product rule for presenting a track-backed library through artist and album navigation.
---

The library remains track-backed: radio keeps and imported songs stay as individual saved items with their provenance and timestamps. Artist rows are only a navigation index, and album surfaces are derived from the saved/imported tracks belonging to that artist.

**Why:** Listeners want to browse by artist and album without losing the ability to replay the exact songs that populated the library.

**How to apply:** When opening an artist, default to the album containing that artist's most recently saved track, using the latest keep/import event as the ordering signal. Let the listener cycle through the artist's other known albums with the fixed album-art hero. Album playback is explicit and starts at track 1; do not generate playlists, autoplay, or automatically expand queues. Removing an artist from active tuning/library membership must not delete the underlying saved tracks.