---
name: Home first-play query bounds
description: Why compact home first-play reads need an explicit candidate boundary before historical checks.
---

A compact home first-play preview must drive historical first-play and release-date checks from an explicitly bounded recent candidate relation, not rely on a `LIMIT` subquery in a `WHERE IN` predicate to make a large anti-join cheap.

**Why:** Under the live station archive, equivalent anti-join rewrites and a recent-ID `IN` guard still exceeded the listener read pool's statement timeout. The same bounded-predicate version passed a focused isolated test but failed through the live API under background load, so isolated latency is not proof of the production read shape.

**How to apply:** Materialize the candidate relation or separate recent-candidate selection from historical checks, preserve the distinction between a partial compact preview and complete archive scans, and verify both the query plan and a live request under normal background load.