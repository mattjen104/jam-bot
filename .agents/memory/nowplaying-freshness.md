---
name: Now-playing freshness contract
description: observedAt/freshness semantics for spins and the unchanged-track refresh rule
---

The freshness class (fresh/aging/stale, budget = 2×/6× source cadence) keys off `spins.observed_at` — when Lore last CONFIRMED the track, not when it was first written.

**Rule:** every dedup path that suppresses an unchanged current track must still refresh the latest spin's `observed_at` (observation refresh only — no new spin, no spin-changed event). This applies to the change-detection primary dedup and to stable-id history dedup for LIVE polls; backfill/reconcile sweeps must never refresh (a historical slice is not a "still on air" confirmation).

**Why:** without the refresh, a healthy ICY station playing a normal 4-minute song classifies stale after 60s and gets falsely flagged "may be delayed" + loses live-crossing hit flags. This exact bug was caught by code review on first submission.

**How to apply:** any new ingestion tier or dedup shortcut must ask "does this observation confirm the current track?" — if yes, refresh observed_at. Client side: absence of `freshness` = unknown ⇒ treat as non-stale (old payload compatibility); the single live-crossing gate is `gateLiveHitFlags` in the lore app.

Also: local vitest runs sharing the merge-gate flock (`/tmp/api-server-vitest.lock`) will silently block behind a running completion validation — an "endless hang" with an empty log usually means the lock is held, not that the suite is slow.
