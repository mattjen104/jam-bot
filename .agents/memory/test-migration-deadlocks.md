---
name: Test-suite migration DDL deadlocks
description: Why boot migrations must never re-run inside parallel vitest workers, and the advisory-lock pattern for concurrent boots
---

Boot migrations (CREATE/ALTER TABLE) must run exactly once in `test/globalSetup.ts`, never in a test file's `beforeAll` or inside a test body.

**Why:** A migration with constraint-swapping DDL (`ALTER TABLE ... DROP CONSTRAINT` + `ADD CONSTRAINT`) takes AccessExclusiveLock; run mid-suite it deadlocks (40P01) against other workers' DML on the same tables. Wrapping the migration in one transaction makes this *worse* — it holds locks across all its tables at once.

**How to apply:**
- New DB-backed test files: rely on globalSetup; never call `apply*Migration()` per file.
- For real concurrent boots (multiple server instances), serialize the migration with `pg_advisory_xact_lock` inside a `db.transaction` (see replay-resolution-migration).
- "Migration is idempotent" should not be re-asserted by running it mid-suite.
