---
name: Hand-patched generated clients drift from openapi.yaml
description: Why generated/api.ts in lib/api-zod and lib/api-client-react can silently diverge from lib/api-spec/openapi.yaml, and what breaks when it does.
---

Some endpoints in this project got their zod schemas/types added by hand directly into the generated client files instead of into `openapi.yaml` first.

**Why:** `openapi.yaml` is the codegen source of truth. When it drifts from the hand-patched generated output, everything looks fine until someone runs a clean codegen — that wipes the hand-added exports, and since the API server and web app import them under strict ESM, missing exports crash the whole process at import time (not just the affected route).

**How to apply:** Add new endpoint schemas to `openapi.yaml` first, never patch generated files directly. After any codegen run, typecheck the libs and the api-server to catch missing-export breakage immediately instead of at runtime.

**Recovery when you discover this drift mid-task (main agent has no `git checkout`):** restore the generated files to HEAD one at a time with `git show HEAD:<path> > <path>` (covers `generated/**` and the package's hand-written `index.ts` barrel), delete any stray untracked files codegen left behind, then hand-patch in ONLY the new symbols your task actually added. Confirm with `pnpm run typecheck:libs` before touching route code. Do not attempt to fix the pre-existing drift itself — treat it as out of scope and confirm it predates your change (e.g. reproduce the same tsc failures against HEAD) so you don't get blamed for it.
