---
name: Render-phase ranked snapshots
description: Stability rule for hooks that preserve ranked-card positions while live inputs update.
---

Hooks that intentionally adjust snapshot state during render must compare a semantic key for the ranked input, never the identity of a newly produced array. Callers should also memoize empty-array fallbacks passed into those hooks.

**Why:** Ranking functions and timer-driven memos legitimately produce fresh arrays. A render-phase state adjustment keyed to array identity then causes its own next render to look changed again, resulting in an infinite update loop before data finishes loading.

**How to apply:** Include the fields that can change eligibility, order, or visible content in a deterministic key. Update the snapshot only when that key or the current-item identity changes; keep loading fallbacks referentially stable.