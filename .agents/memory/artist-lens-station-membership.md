---
name: Artist lens station membership
description: Rules for finding every station associated with a focused Library artist without blocking on archive run details.
---

The focused Library artist lens must use exact, case-insensitive all-history station membership across resolved recording artists and unresolved raw artist metadata. Do not derive the set by filtering current Dial rows or bounded top-artist summaries.

**Why:** Bounded crossing summaries returned only one station for artists with broader archive history. Reusing the archive run-detail search was also too slow for common artists because it builds full run summaries that the station lens does not need.

**How to apply:** Keep station membership as a dedicated, indexed, station-deduplicated read model. Map its slugs onto the already-loaded station roster for rendering; reserve artist-run search for set/show detail surfaces.