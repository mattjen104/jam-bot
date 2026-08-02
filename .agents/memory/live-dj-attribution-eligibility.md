---
name: Live DJ attribution eligibility
description: Shared behavior for preventing music and station metadata from being treated as a live DJ.
---

Use one shared, pure DJ eligibility decision at every live-attribution boundary. Normalize invisible characters, case, diacritics, punctuation, and whitespace solely for comparison; retain the cleaned source display name when it remains eligible.

Reject missing/generic placeholders and a DJ value that normalizes to a supplied live artist, track title, show title, or station name. Do not reject by name shape: single-word public aliases and multi-host credits are valid when they do not collide with available context. Historical records remain unchanged; defensive API/UI filtering prevents old bad rows from reappearing as current on-air attribution.

**Why:** independent heuristics had let source metadata such as an artist, show title, or automation label surface as a human selector and create bad picker associations.

**How to apply:** pass every known comparison context at a boundary. NTS's live endpoint is show-level (host/title), not track-level, so do not use its host as an artist-collision signal. Any newly added ingestion, live serializer, picker bridge, or Dial ranking path must use the same utility.