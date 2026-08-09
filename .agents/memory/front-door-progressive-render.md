---
name: Front-door progressive render & bounded crossings
description: Dial first-paint decoupling from crossings, computing-flag protocol, cold-compute deadline, and the test pitfalls around it.
---

## The rule
- `zone1Settled` gates ONLY on `isCoreLoading` (station list). Crossings are progressive enhancement: Zones 2/3, ghost rows, and offline sections render while crossings load; only Zone 1's own rows swap for the skeleton.
- Zone 1 rows must be hidden on `crossingsLoading` directly (NOT on the 150ms-delayed `showSkeleton`), or real rows flash during the skeleton grace window. The skeleton itself still uses the delayed flag.
- The skeleton/row mutual-exclusion contract is scoped to `#zone1-rows .fdrow` — Zone 3 `.fdrow` rows legitimately coexist with the Zone 1 skeleton.
- `useBoundedPending(pending, deadlineMs)` (exported from useDialData) caps how long the Zone 1 skeleton can stay up (~25s); a stuck compute degrades to rendering what's there.

## Server protocol
- `/api/me/crossings` cold path (both caches miss, user has taste): schedules the background recompute and races it against a ~2.5s deadline. If it loses, responds `{ items: [], computing: true }` (never cached). Client (`useMyDialCrossings`) polls every 4s while `computing`.
- The empty-taste fast path must count unresolved `spotify_library_items` (soft-artist taste) as taste, alongside library_items and taste_seeds — otherwise soft-only users get a cached-empty result for 30 min.
- `apiFetch` in meHooks applies a default 15s `AbortSignal.timeout` so hung fetches become retryable errors, never eternal loading gates.

## Test pitfalls
**Why:** on the production-scale test DB the compute outlives the 2.5s deadline, so any DB test asserting inline crossings results races it.
**How to apply:** test files that assert fresh compute results must pin `_testOnly_setColdComputeDeadline(120_000)` at module level (restore in afterAll); the setter's restore fn returns to the *previous* value so nested overrides compose. To test the bounded path, set the deadline to 0 and poll until `computing` clears.
