---
name: Now-playing replay epochs
description: Correctness rules for resumable now-playing SSE replay and REST reconciliation.
---

SSE event cursors and per-station versions are valid only within one server-process epoch. A reconnect must carry both cursor and epoch; an epoch mismatch or expired replay cursor requires an authoritative REST snapshot.

Accepted SSE frames must also be buffered until the initial REST cache exists, then drained over that snapshot in event order.

**Why:** Numeric event IDs can collide after restart, and an ordinary monotonic merge can preserve a stranded provisional frame over the older persisted row returned by an intentional fallback. At cold start, acknowledging an SSE cursor before the first REST cache exists can otherwise discard a frame permanently.

**How to apply:** Treat explicit snapshot fallback differently from routine REST polling: clear provisional/process-local ordering state first. Attach REST versions only when they describe the exact persisted spin selected by that read model. If a push arrives before initial REST state, queue it and apply it after the snapshot rather than dropping it.