---
name: api-server vitest test location
description: Where api-server tests must live to actually run
---
The api-server vitest config only includes `test/**/*.test.ts`. Any `*.test.ts` placed next to sources under `src/` is silently skipped — the suite still passes, so the omission is invisible.

**Why:** Colocated tests (backfill, nts, spotifyConnect) sat unrun for a whole phase; when finally moved into `test/`, two of them exposed real null-safety bugs in the NTS parsers.

**How to apply:** Always create api-server tests under `artifacts/api-server/test/` with `../src/...` imports. After adding a test file, confirm the suite's file/test count increased.
