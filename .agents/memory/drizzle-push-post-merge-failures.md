---
name: drizzle-kit push post-merge failure modes
description: Three recurring reasons the post-merge `drizzle-kit push` step fails on this project and how to fix each
---

# drizzle-kit push failure modes (post-merge script)

The post-merge script runs `printf '\n' | pnpm --filter db push-force`. When it fails, check these three causes in order — all have occurred:

1. **Column type drift under a view (0A000 "cannot alter type of a column used by a view")**
   Boot migrations create columns as `timestamptz`, but a later drizzle declaration of the same column without `{ withTimezone: true }` makes push emit an ALTER TYPE, which Postgres rejects if a view (e.g. `picks_unified`) depends on the column.
   **Fix:** match the drizzle declaration to the live type (`withTimezone: true`), never drop/recreate the view to appease push.

2. **Boot-migration-only tables get DROP'd (data-loss prompt)**
   Tables created only by api-server boot migrations (e.g. `job_timestamps`) are unknown to drizzle and push proposes deleting them.
   **Fix:** declare the table in `lib/db/src/schema/` with a comment that DDL ownership stays with the boot migration.

3. **FK re-validation hits orphaned rows (23503 during push)**
   Push sometimes re-adds FK constraints; orphaned rows (test fixtures, cache rows for deleted `lore_users`, `embed_link`/queue rows for pruned recordings) abort it. The live API server keeps *writing new* orphaned cache rows, so prune + push in one window, or the same error recurs with a new key.
   **Fix:** generic prune loop over `information_schema` FK/column lists (`DELETE ... WHERE NOT EXISTS (parent)`) for tables referencing `lore_users`, `recordings`, `stations`; cache tables are safe to clear.

**Why:** push compares declared schema vs live DB with no memory of boot migrations, and this project deliberately mixes drizzle-pushed schema with idempotent boot-migration DDL.
**How to apply:** whenever a merge adds boot-migration DDL, mirror it in the drizzle schema in the same change; whenever push fails post-merge, read the stderr detail line — it names the table/constraint and exact orphan key.
