---
name: Scheduled speech boundary observer
description: Durable admission and adaptive sampling rules for schedule-directed local speech capture.
---

Schedule-directed speech work must persist a boundary prediction, then claim a time-bucketed capture attempt in the immutable database ledger **before** reserving process-local capture quota. Recent predictions without terminal outcomes remain retryable across restarts; stable per-show evidence gets a sparse deterministic sample and an explicit terminal skip outcome.

**Why:** A process-local reservation taken before the database claim lets a losing worker consume its quota. If the winning worker then dies, the survivor can win a later database attempt but remain blocked by its stale local reservation. Separately, relying on a short boundary-detection window loses work after transient write failures.

**How to apply:** For scheduled observers, use the persisted prediction as recoverable pending work, five-minute database attempt keys as cross-worker leases, and terminal capture outcomes as completion. Preserve the schedule's actual provenance kind; never label all scraped recurrence as official.