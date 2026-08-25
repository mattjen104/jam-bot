---
name: Listener read-pool isolation
description: Keep live listener responses usable during background database saturation.
---

Listener-facing radio read models need a small reserved database pool with short connection and statement budgets. Public station/track data is mandatory; identity, library-hit decoration, and other personalization are best-effort and must fall back to public data rather than wait on the general background pool.

**Why:** Pollers, backfills, and enrichment can legitimately consume the general pool for long periods. Routing every related query through the reserved pool also fails: a home page issues many unrelated authenticated requests that can crowd out the few live reads it is meant to protect.

**How to apply:** Reserve the pool for the minimal live read queries only. Bound optional identity and personalization separately, keep archive semantics distinct from any home-only fast path, and test a real signed listener with a cold personalization cache while the general pool is saturated.