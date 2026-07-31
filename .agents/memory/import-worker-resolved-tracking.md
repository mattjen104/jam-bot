---
name: Import worker resolved-vs-processed tracking
description: matchedIdx conflates positive MBID hits with confirmed-miss negative cache entries; use separate sets when the distinction matters downstream.
---

## Rule
Never use `matchedIdx` alone to determine which import buffer entries to treat as "genuinely resolved". `matchedIdx` is populated for **both** positive MBID matches AND Phase-2 negative-cache confirmed misses (entries added to skip Phase 3). These two populations must be separated when the downstream logic cares only about real resolutions (e.g. soft-row seeding, counts).

**How to apply:** Maintain a separate `resolvedMbidIdx = new Set<number>()` alongside `matchedIdx`. Add to `resolvedMbidIdx` only when a real MBID is found (Phase 1, Phase 2 positive hit, Phase 3 positive hit). Never add for confirmed-miss paths (`hit === null`). Use `resolvedMbidIdx` for any logic that must exclude only truly resolved tracks.

**Why:** A confirmed-miss entry (negative cache hit) is still an unresolved track the listener saved. Grouping it with resolved tracks causes it to be silently excluded from features like soft-row seeding, producing an incomplete library view for the user.
