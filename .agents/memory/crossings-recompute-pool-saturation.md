---
name: Background recompute pool saturation
description: Unbounded per-user background recomputes saturate the shared pg pool and hang ALL HTTP traffic while background loggers keep running.
---

**Rule:** Any job that schedules per-user heavy computes (each holding multiple pool connections for seconds) must run through a global concurrency gate — cap concurrent computes (2 is enough), queue the rest.

**Why:** The boot warm job queued hundreds of personal-crossings recomputes (throttled only at *scheduling*, 500 ms apart — not at *execution*). Each compute runs two heavy aggregates in parallel on the shared `pg` Pool (default max=10). Once ~5 computes overlapped, every pool connection was held; all HTTP routes — including `/api/health`'s `SELECT 1` — queued forever. Symptom signature: **server logs stay busy (pollers/console fine) but every HTTP request times out, even no-DB routes are fine (`/api/healthz` 200) while DB routes hang.** pg_stat_activity shows almost nothing "active" because the queries finish; the queue is client-side in the Pool.

**How to apply:** The gate lives next to `schedulePersonalCrossingsRecompute` (acquire/release slot inside the single-flight promise, release hands the slot to the next waiter). If a new background job fans out per-user DB work, either reuse this pattern or push work through the same scheduler. Diagnosis shortcut: compare `/api/healthz` (no DB) vs `/api/health` (SELECT 1) — healthz-ok + health-hang = pool exhaustion, not an event-loop or network problem.
