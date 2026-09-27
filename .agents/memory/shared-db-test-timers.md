---
name: Shared DB test timer isolation
description: Why broad timer interception is unsafe in integration tests using the shared PostgreSQL pool.
---

In DB-backed tests, never accelerate all long `setTimeout` calls to simulate a worker backoff. The database pool can use the same duration for idle-client cleanup; fast-forwarding that callback closes active clients and makes later tests fail in unrelated ways.

**Why:** A test spy intended to skip a long import backoff also ran PostgreSQL's idle-client timer, causing closed-client errors and a cascade of failures.

**How to apply:** Mock the worker's own sleep boundary while leaving global timers intact. An observational timer spy is safe only if it delegates every callback to the real timer.