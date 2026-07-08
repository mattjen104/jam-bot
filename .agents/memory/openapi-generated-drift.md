---
name: Hand-patched generated clients drift from openapi.yaml
description: Why generated/api.ts in lib/api-zod and lib/api-client-react can silently diverge from lib/api-spec/openapi.yaml, and what breaks when it does.
---

Some endpoints in this project got their zod schemas/types added by hand directly into the generated client files instead of into `openapi.yaml` first.

**Why:** `openapi.yaml` is the codegen source of truth. When it drifts from the hand-patched generated output, everything looks fine until someone runs a clean codegen — that wipes the hand-added exports, and since the API server and web app import them under strict ESM, missing exports crash the whole process at import time (not just the affected route).

**How to apply:** Add new endpoint schemas to `openapi.yaml` first, never patch generated files directly. After any codegen run, typecheck the libs and the api-server to catch missing-export breakage immediately instead of at runtime.
