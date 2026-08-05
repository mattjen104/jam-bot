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

**Update (Aug 2026):** shared helper `migration-advisory-lock.ts` (api-server src/lore) holds the lock-key registry; any migration transaction with multi-lock DDL/DML must take `acquireMigrationLock(key)` as its FIRST statement. Mocked migration tests count/index execute calls — adding the lock statement shifts their expected indices.

**Advisory locks are not enough:** they only serialize migrations against each other, not against concurrent test DML — a re-run FK swap (AccessExclusive on the table AND the referenced table, e.g. stations) still deadlocks against another worker's DELETE. Constraint-swapping DDL must be skip-when-applied: check pg_constraint / pg_attribute first and only DROP/ADD when the installed shape differs, so per-file migration re-runs take no exclusive locks at all.

Even no-op `ADD COLUMN IF NOT EXISTS` / `SET NOT NULL` take AccessExclusive; migration tests that delete the completion ledger and re-run mid-suite (device-identity, automation-class) must skip DDL via information_schema shape checks or they stall/deadlock parallel workers on hot tables (lore_users, stations).
