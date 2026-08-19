---
name: Validation runner for long commands
description: Long/one-off shell jobs must go through startValidationRun — detached nohup/setsid jobs are silently killed, and runs over ~10 min need chunking.
---

Long-running commands (full test suites, multi-minute probe passes) must be
executed via `startValidationRun`, not via `nohup ... &` / `setsid` from
ShellExec: detached background processes are silently reaped within minutes
(logs freeze at the startup banner, no error, no exit record).

**Why:** Two detached vitest suites and a probe pass died silently this way;
the same commands completed reliably under the validation harness.

**How to apply:**
- `setValidationCommand({ name, command })` a temp name, run it, then
  `clearValidationCommand({ name })` so `.replit` isn't left dirty.
- A single run's poll budget is ~600 polls (~10 min). A command longer than
  that dies with `POLL_BUDGET_EXCEEDED` and the harness kills the child —
  split big suites by observed runtime, not equal file counts; a few DB files
  can consume more than five minutes alone.
- Multiple `commandIds` in one `startValidationRun` execute **in parallel** —
  do not batch DB-bound or otherwise contending suites in one run (parallel
  e2e + vitest caused resource flakes). Run them one call at a time.
- Stop the live API workflow before DB-heavy validation. If the broad gate
  times out in unrelated files, run the task-relevant DB files in isolation
  before deciding whether the implementation itself is broken.
