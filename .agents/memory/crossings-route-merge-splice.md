---
name: Crossings route merge-splice corruption
description: me/crossings.ts has been merge-corrupted repeatedly; symptoms and the shared CrossingsRow guard
---
The personal and blended crossings handlers in `artifacts/api-server/src/routes/me/crossings.ts` are near-twins, and merges have repeatedly spliced one handler's cutoff variable names (`spinCutoff`/`blendedWeekCutoff`) or block tails into the other — including a committed syntax error (misplaced `export default router;` mid-function).

**Why:** twin code blocks confuse 3-way merge; a splice compiles as ReferenceError-at-runtime (503 → empty dial) or a TS syntax error.
**How to apply:** after any merge touching this file, run `tsc --noEmit` for api-server and eyeball the "Windowed predicates" sections of BOTH handlers. `CrossingsRow` is now a single shared type exported from lib/db (used by both the route and the `crossings_cache.data` $type) — keep it that way.
