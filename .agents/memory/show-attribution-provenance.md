---
name: Show-attribution provenance
description: Honest provenance rules for show names attached to persisted spins.
---

Persist the source of every new show attribution as stream metadata, a first-party source API, a schedule match, or a manual entry. A populated show identity by itself does not prove the source transmitted a show name.

**Why:** Schedule matching can add a correct show after ingestion, while older rows may have been attributed by several paths that cannot be reconstructed reliably. Reclassifying those rows would create misleading stream-emitted coverage.

**How to apply:** Set provenance at the write path that supplies the show. Leave historical unknowns null, keep schedule-derived counts separate, and define stream-emitted coverage as only direct stream metadata plus first-party source API attribution.