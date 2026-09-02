---
name: Resolver cache versions
description: How text-resolution changes cross permanent cache boundaries without losing audit history.
---

Text normalization or query-variant changes must increment the resolver cache namespace rather than deleting or reusing prior rows. Definitive misses are permanent only inside the resolver version that produced them. Live ingestion and historical replay must use the same direct-then-single-reversal variant policy and duration rejection behavior.

**Why:** Permanent negative caching protects MusicBrainz pacing, but an unversioned miss can block corrected metadata forever. Deleting old rows removes useful audit evidence, while separate live/replay policies can resolve the same raw pair differently.

**How to apply:** Bump the namespace whenever normalization or ordered variants change; leave old rows untouched. Keep temporary provider failures retryable, and route every text-resolution caller through the shared bounded policy.