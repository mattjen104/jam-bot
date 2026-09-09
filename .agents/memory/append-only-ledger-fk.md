---
name: Append-only ledgers vs station deletion
description: lore_observability_append_only trigger blocks the stations FK ON DELETE SET NULL on ledger tables; any station DELETE must skip ledger-referenced rows
---

The observability ledgers (broadcast_timeline_events, boundary_predictions, capture_decisions, transcript_segments, etc.) have `station_id integer REFERENCES stations(id) ON DELETE SET NULL` AND an append-only trigger (`lore_observability_append_only`, observability-migration.ts) that RAISEs on any UPDATE/DELETE. Deleting a station referenced by a ledger row therefore fails with P0001 — the FK's SET NULL fires and the trigger rejects it.

**Why:** append-only evidence is intentional; the FK action conflicts with it. This bit test fixture cleanup (cleanupStationFixtures in station-fixture-audit.ts) and will equally bite any real admin station-deletion path once ledger rows exist.

**How to apply:** before deleting stations, filter out ids referenced by ledger tables (discover them dynamically via pg_trigger → proname='lore_observability_append_only'; the tables can gain new members). Never "fix" this by weakening the trigger. cleanupStationFixtures already implements the skip — reuse that pattern.
