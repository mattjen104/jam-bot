---
name: Apple library identity
description: Durable rules for Apple Music library import identity, provenance, and playback.
---

Apple Music song IDs supplied by MusicKit are authoritative provider identities. Keep the Apple staging row after a recording promotes into the canonical Library, and carry that exact ID into track and album playback. Never infer an Apple ID from text, ISRC-adjacent metadata, or a MusicBrainz release relationship.

**Why:** Canonical MusicBrainz identity and provider playback identity solve different problems. Dropping the staging row after promotion makes exact Apple playback impossible; guessing can play the wrong recording.

**How to apply:** Apple authorization and library scans should use the shared browser MusicKit path. Batch retries must remain idempotent on listener plus Apple song ID, unresolved rows must stay visible, and canonical provenance must identify Apple Music as the import source.