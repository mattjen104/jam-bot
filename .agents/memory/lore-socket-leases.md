---
name: Crossing-score socket leasing
description: How spare persistent-ICY slots are leased; poller lease set is the source of truth
---

Spare persistent-connection slots (budget 40, env LORE_CONNECTION_BUDGET) beyond pinned favorites are leased every ~20 min to non-favorite ICY stations by recency-decayed library-crossing score (60-day window, 14-day half-life, shared library_items pool).

**Rules learned:**
- The poller's internal lease set is the single source of truth. The scheduler's `activeLeases` map is only display bookkeeping and must be pruned against `isLeasedStation()` whenever read (admin flag flips and persistent socket failures drop leases in the poller immediately, outside the scheduler).
- Promotion/demotion must go through the poller's lease functions, which unenroll first — that is what prevents duplicate poll loops; never start a watcher or interval directly from the scheduler.
- Persistent sockets must pick their stream URL via the mount-preference helper (lowest-bitrate mount from `nowPlayingConfig.mounts`, fallback `streamUrl`) in EVERY watcher start path — boot, enroll, and lease. A raw `config.streamUrl` check silently excludes mount-only stations.

**Why:** first review round failed on exactly these two drift classes (allocation endpoint showing dead leases; boot path gating on streamUrl).
