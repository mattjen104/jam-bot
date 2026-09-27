---
name: Merge-gate failure attribution
description: Separate task-caused validation failures from older migration failures without treating an old failure list as current.
---

The task-completion validation can surface failures that predate the assigned change. A historical list of failures is not a current checklist: other work may have repaired them, and live database load can change a timing result.

**Why:** Library-route migration, API contract drift, and shared-database load once produced failures unrelated to a JamBot change. Many migration checks were subsequently repaired; copying the old failure list forward would mislead future diagnosis.

**How to apply:** when completion validation fails, check the current focused result and compare with the pre-change baseline before attributing it to the task. Do not use a validation skip reason for a check that can run but fails.

Configured validation may already be running when a task resumes; a manual test behind the shared `flock` can appear frozen while simply waiting its turn.

**Why:** Resumed checks started alongside the API preview's database backfill. The backfill held a recordings lock while the API test setup waited; a second manual test then queued behind the existing validation run. This looked like a test startup hang even though the database was reachable.

**How to apply:** inspect workflow status and lock ownership before starting another test. Let boot-time backfills finish before interpreting a cold database test's request timeout as a query regression.

Do not make a slow crossings correctness test pass by treating `computing:true` as a settled result or by extending its wait indefinitely.

**Why:** On the shared development database, a cold crossing computation remained unfinished even after the API boot backfill ended and a substantially longer poll window elapsed. That is a performance or test-isolation problem, not proof that the fixture's expected crossing is wrong.

**How to apply:** diagnose the compute and database load separately; retain assertions on the eventual real rows and explicit failure state. Revert experiments that only lengthen the gate without producing a reliable result.

Station schema setup can block read traffic even when its columns already exist: PostgreSQL still takes an exclusive table lock for no-op `ALTER TABLE` and for dropping/recreating an unchanged constraint.

**Why:** Concurrent API boot and DB-test setup queued exclusive locks behind long station reads, then blocked later listener requests. Removing the lock contention did not make cold lifetime crossings fast; these are separate failure modes.

**How to apply:** check catalogs and skip completed DDL on every boot. Do not interpret a completed migration as proof that an unrelated cold aggregation will settle within the test deadline.

Backfills can also hold write locks and produce substantial WAL when an idempotent `UPDATE` assigns existing values to rows without source evidence.

**Why:** A recording audit backfill repeatedly rewrote pending rows with no lyric evidence, competing with schema setup and listener reads even though their logical state did not change.

**How to apply:** restrict recurring backfills to rows with relevant source evidence and a genuinely pending transition; `CASE ... ELSE old_value` does not prevent a PostgreSQL row rewrite.

After merged OpenAPI work, a green codegen reproducibility check does not guarantee the live preview is current. Rebuild composite library declarations and restart both Lore and API workflows when the UI imports a new generated hook or depends on a new route.

**Why:** workflow reconciliation can leave an older Vite lock owner or API process alive, while leaf typechecks read stale generated declarations.

**How to apply:** run the root library typecheck before the Lore leaf check, then verify the new route through the shared proxy rather than assuming the restarted frontend implies a restarted API.
