---
name: api-server vitest contention flakes
description: Full api-server vitest runs flake under load from the running dev server; stop it before validation, retry flakes in isolation.
---

The rule: when the full api-server vitest suites (DB and non-DB) fail during merge validation with random DB-touching tests timing out or failing inserts (file durations >60s), first re-run the failing files in isolation — if they pass, it is contention, not a regression. Stop the `artifacts/api-server: API Server` workflow before re-running validation; its pollers/ICY watchers hammer the shared dev database and starve parallel test workers. Restart the workflow afterwards.

**Why:** A task completion required four validation attempts; each full-suite failure involved different test files that all passed in isolation, and validation only passed after stopping the dev server.

**How to apply:** Before `markTaskComplete` on any task where api-server suites gate the merge, consider stopping the API server workflow in the same CodeExecution call, and restart it after completion.
