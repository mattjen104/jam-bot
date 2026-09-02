---
name: Station history source separation
description: Durable constraints for first-party station archive collection.
---

Treat a station's published play-history source as independent from its live now-playing source. Historical collection must have its own adapter configuration, progress cursor, and health evidence, even when both happen to use the same provider.

**Why:** Stations often publish live metadata through ICY or one platform while exposing their archive through a different API, RSS feed, or structured page. Reusing the live source field or cursor can break polling or move the live cursor backward.

**How to apply:** New archive adapters should read the nested history configuration when present, preserve the live adapter and live cursor, and remain restricted to explicitly curated front-door stations.