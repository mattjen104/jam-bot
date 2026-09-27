---
name: Crossings query performance
description: Keep personal crossing aggregation proportional to a listener's candidate recordings while preserving full-station exposure.
---

# Crossings query performance

Personal lifetime computation must filter the archive to a listener's candidate recordings **before** grouping spins. Rolling windows can be time-bounded, but lifetime crossings cannot be time-bounded without dropping old matches. The lifetime cache is part of the current compute, not an unused fallback.

**Why:** Aggregating every archived spin for every listener, even with matching predicates inside aggregate `FILTER` clauses, made a cold correctness check run past its deadline on a multi-million-spin database.

**How to apply:** Preselect matching recording identities (exact library, album/release-group, or artist), then use the archive MBID index for lifetime counts. Keep the station's lifetime exposure denominator on an independent all-resolved-tracks scan restricted to matching stations; using only the listener's candidates for exposure would silently inflate scores. Preserve a distinct background compute state until true facts are available rather than returning fabricated zeros.
