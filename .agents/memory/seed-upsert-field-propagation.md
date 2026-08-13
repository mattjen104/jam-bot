---
name: Seed upsert field propagation
description: New seed-declared fields must be added to seedStations' onConflictDoUpdate set or existing deployments never receive them.
---

# Seed upsert field propagation

Adding a new field to `SEED_STATIONS` entries only affects **fresh databases** unless the field is also added to `seedStations()`'s `onConflictDoUpdate.set`. Already-deployed rows hit the conflict path and keep their old values — the feature silently works in dev-from-scratch and fails everywhere real.

**Why:** The /college filter shipped with `tags: ["college"]` in the seed but the upsert never updated `tags`; code review caught that every existing deployment would return zero college stations.

**How to apply:** Whenever a seed entry gains a new column/value that a feature depends on, check the upsert's `set` block. For operator-editable jsonb fields like `tags`, don't overwrite — merge (set union via `jsonb_array_elements_text` + `jsonb_agg(DISTINCT ...)`), and keep the stored value untouched when the seed declares none (`CASE WHEN EXCLUDED.x IS NULL THEN stored ELSE merged END`). Some fields are deliberately NOT propagated (e.g. `crossingEligible`) so operators can override — read the existing comments before adding to the set.
