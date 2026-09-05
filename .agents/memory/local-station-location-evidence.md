---
name: Local station location evidence
description: Privacy and evidence rules for ZIP-radius station discovery.
---

Resolve listener ZIPs locally and keep them request-scoped: never write a ZIP or listener-derived coordinate to station, playback, listening, user-history, or device station records.

Station coordinates describe where a station is based, not where its signal can be received. Keep locality, coordinates, source, and confidence together; use “based in” and approximate straight-line distance language.

Strict radius searches must exclude missing, impossible, and null-island coordinates while reporting how many catalog/directory rows were excluded. Ordinary non-radius discovery may still show those stations.

**Why:** A ZIP is sensitive listener input, and radio reception cannot be inferred honestly from a station-base centroid. Mixing listener and station coordinates would create both a privacy leak and a misleading coverage claim.

**How to apply:** Any location importer must preserve stronger curated evidence, label directory or locality-centroid evidence explicitly, and never derive canonical station coordinates from the listener’s current ZIP.