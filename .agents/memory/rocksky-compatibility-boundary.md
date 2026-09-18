---
name: Rocksky compatibility boundary
description: Durable constraints for treating Rocksky as an optional music-reference layer in Lore.
---

Treat Rocksky as optional offline interoperability evidence, never as Lore's
identity authority or a request-time dependency. Lore observations and
resolution claims must remain intelligible without it.

**Why:** The first stratified compatibility study found that deployed
`getSong` turns absent identifiers into HTTP 500 despite source code intending
a typed not-found response. ISRC lookup also returned conflicting MusicBrainz
recordings/editions, while MBID matches were substantially safer.

**How to apply:** Accept an MBID-linked Rocksky URI only after metadata sanity
checks. Hold ISRC results as claims and reject them when they conflict with
Lore's MBID. Never cache Rocksky 500s as definitive misses or put Rocksky on
live ingestion/playback paths.