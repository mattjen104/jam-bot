---
name: Ranking simulation parity
description: How to keep offline ranking previews reproducible in the production Lore read model.
---

Ranking simulations must use the same station eligibility, listener-match semantics, identity confidence, and time windows as the production read model. Do not promise an exact station list from a nearby SQL approximation.

**Why:** A rarity simulation that omitted production-only album widening produced a plausible top ten that the real scorer could not reproduce. Live rolling-window data also changed the boundary positions while implementation was underway.

**How to apply:** Share scoring inputs or pure scorer code between simulations and production. Treat named top lists as time-stamped validation snapshots, not permanent acceptance criteria, unless the product explicitly wants pinned editorial results.