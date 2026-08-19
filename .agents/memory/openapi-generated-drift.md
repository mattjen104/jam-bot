---
name: Hand-patched generated clients drift from openapi.yaml
description: openapi.yaml is the codegen source of truth — never hand-patch generated clients; the api-contract/api-codegen-repro validations now gate this.
---

`openapi.yaml` is the codegen source of truth. Endpoints were once hand-patched straight into the generated clients, which looks fine until a clean orval run silently deletes those exports — and strict-ESM importers then crash the whole server/web process at import time, not just the affected route.

**Why:** a runtime import failure from a deleted generated export is a broad, late-surfacing break; drift must be caught before regeneration, not after.

**How to apply:** add new endpoint schemas to `openapi.yaml` first, never patch generated files directly; intentional non-spec routes (plain-JSON, admin, redirect, SSE, media) must be listed in `lib/api-spec/contract-exceptions.json` with a kind and reason. The mechanical guardrails (contract check + clean-regen reproducibility check, including the scanner covering helper-mounted routes outside `src/routes/`) live in `lib/api-spec` — see its README for failure classes and commands.
