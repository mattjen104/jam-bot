---
name: Durable source-coverage evidence
description: How verified station metadata outcomes survive fresh deployments without defeating later live probes.
---

Verified station-level probe facts that define the intended coverage class must be reproducible on a fresh database. Seed the missing evidence idempotently, while treating any existing probe row as newer operator-owned evidence.

**Why:** Updating only the live database can make the current environment look correct while a clean deployment falls back to configuration-shape guesses. Re-seeding on every boot would create the opposite problem by overwriting later live probes.

**How to apply:** When a curated station audit establishes a durable outcome, seed its initial probe evidence only when no row exists. If an endpoint is known dead, also retire it from playback/polling instead of relying on the adverse probe alone.