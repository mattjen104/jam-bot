---
name: Crossings empty-taste fast path & bust contract
description: /me/crossings caches [] for taste-less users; every library-item-creating path must bust the cache
---
GET /me/crossings short-circuits when a user has no active library_items and no taste_seeds: two cheap existence checks, then a cached empty result (L1+L2), instead of the ~24s full compute. First-time/anonymous sessions render the front door immediately.

**Why:** the heavy compute can only ever yield [] for a taste-less user, yet fresh sessions (each cookie-less request = new anon user) paid the full cost, leaving the dial rows in skeleton for ~24s.

**How to apply / the contract:** any code path that creates or restores a crossing-eligible library_items row MUST call `bustCrossingsCache(userId)` or the user can see the cached empty (or stale) result for up to 30 min. Currently covered: import worker completions, manual/lb imports, keep endpoint (both spin-based and mbid branches), Phase-3 off-peak retry promotion, taste-seed PUT, library removal. New promotion paths (e.g. Apple staging) must add it too.
