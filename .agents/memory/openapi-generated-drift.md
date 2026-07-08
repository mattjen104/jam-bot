---
name: Hand-patched generated clients drift from openapi.yaml
description: Why generated/api.ts in lib/api-zod and lib/api-client-react can silently diverge from lib/api-spec/openapi.yaml, and what breaks when it does.
---

Several already-shipped Lore endpoints (song-exploder episodes, radio-browser admin, recording availability, pickers dial, station schedule/recent-spins) had their zod schemas and TS types added directly into `lib/api-zod/src/generated/api.ts` and `lib/api-client-react/src/generated/*` by hand, instead of being defined in `lib/api-spec/openapi.yaml` and produced via orval codegen.

**Why this matters:** `openapi.yaml` is the source of truth orval regenerates from. When it's out of sync with the hand-patched generated files, everything looks fine until someone runs a clean `orval` codegen (e.g. to fix an unrelated schema bug) — that wipes every hand-added export. Because api-server and the lore web app import these named exports under strict ESM, missing exports crash the whole process at import time, not just the affected route.

**How to apply:** Before running orval codegen in this project, diff `openapi.yaml`'s paths/schemas against what routes in `artifacts/api-server/src/routes/lore/*.ts` actually import from `lib/api-zod`/`lib/api-client-react`. If a route uses a schema/type not defined in openapi.yaml, add it to openapi.yaml first (don't just hand-patch the generated file again) so the drift doesn't recur. After any codegen run, run `pnpm run typecheck:libs` and `pnpm --filter @workspace/api-server exec tsc --noEmit` to catch missing-export breakage immediately, before it surfaces as a runtime crash.
