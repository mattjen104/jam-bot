---
name: Dial history scanner read model
description: Durable constraints for the shared archived-spin scanner.
---

The Dial history scanner uses a plain JSON, keyset-paginated read model with a fixed snapshot and a local-only progress key derived from scope, category selection, station, and eligibility filter.

**Why:** Archived spins are too large and too mutable to preload safely; mixing progress between selections makes a resumed scan misleading.

**How to apply:** Keep archive pages bounded and stable for the snapshot, keep preview ownership separate from live radio while ducked, and evict local progress entries by age/count.