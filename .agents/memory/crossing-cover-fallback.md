---
name: Crossing cover fallback
description: How to render crossed crate artwork when historical recordings lack release-group identity.
---

Exact historical crossings can greatly outnumber rows in the recording-to-release-group bridge. A missing release-group row must not be interpreted as a missing crate crossing or missing cover.

**Why:** A real large library had thousands of exact matched spins and abundant saved artwork, but zero primary release-group bridge rows. An inner join produced a clean, empty album list and broad recomputation obscured the real data gap.

**How to apply:** Drive cover lookup from exact active library recording MBIDs and indexed spins. Left-join release groups. Link to the album when identity exists; otherwise retain the cover and link to the recording page. Keep album enrichment off the request hot path.