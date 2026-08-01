# API Server Test Conventions

## Shared real database

Integration tests (files ending in `-db.test.ts`) run against a real PostgreSQL
database shared by all test files in the suite.  Every test must be fully
self-contained — insert its own rows, clean them up in `afterEach`/`afterAll`,
and never depend on data left behind by another file.

---

## ⚠️ Global-scan functions: use `_testUserIds` scope hooks

Some background-worker functions scan the entire contents of a DB table with no
`userId` filter — they are designed to iterate over _all_ users' data.  If a
test calls one of these functions without scoping it to the test's own user IDs,
it will pick up rows from other concurrently-running test files and produce
non-deterministic, CI-only failures.

### The pattern

Exported global-scan functions expose an optional `_testUserIds` parameter.
Always pass it in tests:

```ts
import { runPhase3RetryPass } from "../src/routes/me/library.js";

// ✅ Correct — scoped to this test's users only
await runPhase3RetryPass(undefined, [userId]);

// ❌ Wrong — scans every user's rows and will cross-contaminate other test files
await runPhase3RetryPass();
```

When `_testUserIds` is provided and non-empty the function adds an
`inArray(userId, _testUserIds)` predicate to its query, making its scan
hermetically isolated to the supplied set.  Pass an empty array `[]` only if
the function documents that behaviour as a no-op guard; otherwise always supply
the real test user IDs.

### Known global-scan functions — audit notes

| Function | File | Has `_testUserIds` hook? | Notes |
|---|---|---|---|
| `runPhase3RetryPass` | `src/routes/me/library.ts` | ✅ yes | Pass test user IDs from every Phase-3 retry test |
| `markOrphanedSyncJobsAsError` | `src/routes/me/library.ts` | ❌ no hook | Boot-only utility; targets `status IN ('running','pending')` rows. Tests that leave jobs in those states (e.g., `sync-job-lifecycle-db.test.ts`) must reset status in `afterEach` before this can be safely called from test code |
| `markOrphanedImportJobsAsError` | `src/routes/me/library.ts` | ✅ yes | Pass test user IDs from every test that calls this function |
| `enrichIsrcBatch` | `src/lore/isrc-enrichment.ts` | ❌ no hook | Scans all recordings that have no ISRC and are referenced by any `library_items` row. Tests that insert un-enriched recordings should either set `isrcCheckedAt = now()` on insert to opt out, or not call `enrichIsrcBatch` directly |

### Adding a new global-scan function

If you write a function that queries or updates a table without a `userId`
predicate (e.g., a nightly cleanup, a scheduler pass, an enrichment batch):

1. Add an optional `_testUserIds?: number[]` parameter.
2. When the array is non-empty, inject `inArray(table.userId, _testUserIds)`
   into the `where` clause alongside the other predicates.
3. Add a row to the table above.
4. In every test that calls the function, pass the test user IDs.

The naming prefix `_test` signals to future readers (and linters) that this
parameter is **only** for test isolation — it must never be set from
production code paths.

---

## Test user ID uniqueness

Each test file should create users with IDs that are unlikely to collide with
other files.  A reliable approach is to derive IDs from the test file's own
fixtures rather than using sequential small integers.

## `vitest` file isolation

Each test file runs in its own `vitest` worker — the DB connection pool, module
cache, and global variables are **not** shared across files.  However, the
**database itself** is shared, so the isolation rules above apply regardless of
worker boundaries.
