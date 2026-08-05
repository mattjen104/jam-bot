---
name: server-db-tests merge gate
description: How the DB-backed api-server vitest suite is gated and why it flakes at higher parallelism.
---
The `server-db-tests` validation step runs `vitest run --config vitest.db.config.ts` (only `test/**/*-db.test.ts`, 66 files, ~4–5 min). It complements `server-tests`, which excludes those files.

**Why:** at maxWorkers 4 the heavy-aggregation files (me-overlaps, me-crossings, now-playing-first-spin, import-worker) hit shared-Postgres contention against the ~1M-row spins table and time out; at maxWorkers 2 the suite is consistently green and no slower overall.

**How to apply:**
- Keep maxWorkers=2, testTimeout 60s, hookTimeout 120s in vitest.db.config.ts.
- Inline per-test timeouts OVERRIDE the config — never write a 30s inline timeout in a `*-db.test.ts` file (use 90_000 if one is needed). A sweep already raised all existing ones.
- Never hardcode calendar dates in assertions (a replay export test baked in a date and broke two days later); derive from the seed base timestamp.
- Full rules also documented in artifacts/api-server/test/TEST_CONVENTIONS.md.

**Concurrency:** the merge gate runs all validation commands in parallel; both vitest suites are wrapped in `flock /tmp/api-server-vitest.lock` so they serialize — running them concurrently flaked the fast suite's beforeAll hooks on DB contention.
