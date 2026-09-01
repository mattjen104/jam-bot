---
name: Minimal radio crossing fixtures
description: Browser fixture requirements for the focused radio surface's active and Lifetime crossing filters.
---

Front-door browser fixtures must seed both a fresh now-playing item with `isLibraryHit` or `isArtistHit` and matching `/api/me/crossings` aggregate rows with lifetime counts. The live hit makes a station eligible in the active window; the server aggregate makes it remain eligible after selecting Lifetime.

**Why:** Seeding only now-playing hits makes the default surface render correctly but causes Lifetime mode to filter every row out, because the normalized dial data reads Lifetime counts from the crossings endpoint rather than station objects.

**How to apply:** When adding or updating focused-radio fixtures, include the station slugs in the mocked crossing payload as well as the now-playing hit flags; do not rely on extra crossing fields attached directly to station fixtures.