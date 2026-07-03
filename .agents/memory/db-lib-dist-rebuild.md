---
name: db lib dist rebuild
description: lib/db compiles to a dist/ folder consumed by api-server via project references — stale dist/ causes "no exported member" errors after schema changes.
---

# db lib dist rebuild

## Rule
After adding or changing schema exports in `lib/db/src/`, rebuild the lib before type-checking api-server:

```bash
pnpm --filter @workspace/db run build   # or: cd lib/db && tsc -p tsconfig.json
pnpm --filter @workspace/api-server run typecheck
```

**Why:** api-server consumes lib/db through TypeScript project references (`tsconfig.json` `references`). Project references read from `dist/` — not from `src/`. If you add a new export to `lib/db/src/schema/lore.ts` and forget to rebuild, api-server will report "Module ... has no exported member '...'" even though the source is correct.

**How to apply:** Whenever a schema file in `lib/db/src/` changes, run the db build step first. The `typecheck:libs` pnpm script at workspace root rebuilds all libs — use that as a safe alternative.
