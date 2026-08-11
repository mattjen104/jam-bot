---
name: api-server vitest contention flakes
description: Full api-server vitest runs flake under load from the running dev server; stop it before validation, retry flakes in isolation.
---

The rule: when the full api-server vitest suites (DB and non-DB) fail during merge validation with random DB-touching tests timing out or failing inserts (file durations >60s), first re-run the failing files in isolation — if they pass, it is contention, not a regression. Stop the `artifacts/api-server: API Server` workflow before re-running validation; its pollers/ICY watchers hammer the shared dev database and starve parallel test workers. Restart the workflow afterwards.

**Why:** A task completion required four validation attempts; each full-suite failure involved different test files that all passed in isolation, and validation only passed after stopping the dev server.

**How to apply:** Before `markTaskComplete` on any task where api-server suites gate the merge, consider stopping the API server workflow in the same CodeExecution call, and restart it after completion.

## Blended crossings L2 cache is a single shared Postgres row

The `/me/crossings/blended` L2 cache is one Postgres row (id=1) shared by every
process touching the test DB. Any test that hits the blended endpoint without
clearing the L2 row before AND after (awaiting `_testOnly_clearBlendedCrossingsL2Cache`,
which also settles the fire-and-forget write) will poison parallel vitest
workers in other files: their "fresh compute" assertions read the polluted row
as a valid <60s cache hit. Symptom: presence-TTL / spin-window tests in
me-crossings-db.test.ts intermittently see crossings=1 where 0 is expected, or
missing rows. Both cache layers must be cleared around every blended request in
every test file — L1-only clearing is the bug.
