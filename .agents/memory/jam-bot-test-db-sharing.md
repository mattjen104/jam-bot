---
name: jam-bot test DB sharing
description: How the jam-bot vitest DB is scoped, and the cache-key collisions and order-flakiness it causes.
---

# jam-bot test DB sharing

`test/setup.ts` points `DATABASE_PATH` at a fresh temp file. The DB is **shared
across all tests within a single test file** (one file = one DB), but **isolated
between files** (each file's worker runs setup and gets its own temp DB).

**Why it matters / how to apply:**
- Any test asserting on a value written through a cache keyed by a *constant*
  (e.g. the `track_context` artist cache keyed by artist NAME) will collide with
  another test in the same file that wrote a different value under that key.
  Fix: give each such test a **unique artist name / unique ISRC** so its cache
  entry can't be polluted by a sibling test. (Mirrors how knowledge tests use a
  unique ISRC per test.)
- `wrapped.test.ts` is order-/load-flaky: it asserts a buried track is NOT in
  `recentPlayed(25)` after inserting many filler plays. It passes in isolation
  but can fail under parallel-file CPU load when many `recordPlayed` rows share a
  timestamp and the ordering tiebreak is ambiguous. Adding more test files
  increases parallel load and can surface this. It's a pre-existing test-quality
  issue (timestamp-tie ordering), not a product bug; re-running usually goes
  green. A real fix would be a deterministic tiebreak in `recentPlayed`.
