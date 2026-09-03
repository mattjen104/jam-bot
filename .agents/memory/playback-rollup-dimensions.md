---
name: Playback rollup dimensions
description: How to extend privacy-safe playback telemetry without collapsing distinct aggregate cohorts.
---

Any new privacy-safe playback telemetry dimension used to compare aggregate cohorts must be included in the durable rollup row identity, aggregation key, response, and existing-table migration together.

**Why:** Adding a dimension only to event/API types collapses distinct cohorts into the same daily database row after telemetry becomes durable, producing valid-looking but incorrect comparisons.

**How to apply:** When extending playback-health grouping, update the atomic upsert conflict key, database primary key and idempotent upgrade, Drizzle declaration, read aggregation key, OpenAPI response, and DB-backed regression test as one change.