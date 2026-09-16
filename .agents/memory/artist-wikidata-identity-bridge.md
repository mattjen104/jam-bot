---
name: Artist Wikidata identity bridge
description: Grounding and bounded-fetch rules for artist metadata sourced through MusicBrainz and Wikidata.
---

Accept a Wikidata QID only from an explicit HTTPS Wikidata URL relation on the MusicBrainz artist identified by the requested MBID. Never search Wikidata by artist name or use similarity as identity evidence. Map only allow-listed facts, keep relationship and label lookups bounded, and treat provider failures as optional metadata failures.

**Why:** Name search and similarity can attach plausible but false biographies to the wrong artist. Provider latency or outages must not break the primary artist page.

**How to apply:** Cache successes longer than confirmed misses and errors; keep the metadata endpoint status-bearing; display related-entity labels when the bounded lookup succeeds and fall back honestly to QIDs.