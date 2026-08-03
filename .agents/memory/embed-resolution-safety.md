---
name: Embed resolution safety model
description: Constraints for resolving optional Bandcamp and YouTube embeds without inventing provenance or affecting listener flows.
---

Embed discovery must remain strictly asynchronous relative to spin ingest, first play, replay loading, and Keep. A request path may create demand but must never wait for MusicBrainz, Bandcamp, or YouTube network work.

**Why:** Provider availability and rate limits are variable. Making listener paths wait either harms the live radio experience or pressures the resolver to fabricate a plausible answer.

**How to apply:** Treat MusicBrainz relationship URLs as provenance facts. For Bandcamp, only fetch a safe HTTPS `*.bandcamp.com` release URL that MusicBrainz already supplied; do not search or crawl arbitrary sites. Preserve ambiguous track matches as album/link-out instead of guessing. YouTube search candidates must satisfy the Topic/official-distributor gate or the normalized artist/title plus ±5-second duration gate. Queue retry and expiry work must never permit one provider failure to block subsequent work.