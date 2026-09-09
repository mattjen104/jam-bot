---
name: Orval pitfalls (codegen collisions, duplicates, drift, non-200 schemas)
description: Recurring orval/OpenAPI codegen traps in lib/api-spec — check here before adding or editing endpoints.
---

# Orval / OpenAPI codegen pitfalls

`openapi.yaml` is the codegen source of truth. Recurring traps:

## 1. `<Op>Params` name collision (path + query params)
An operation with BOTH a path param and a query param generates two symbols
with the same name — `GetRecordingEntryParams` in `generated/api.ts` (zod
path validator) and in `generated/types/` (query-params TS type). The api-zod
barrel's `export *` from both collides: `TS2308: already exported a member`.
**Why:** orval derives both symbol names from the operationId with no
cross-folder disambiguation.
**How to apply:** after adding a query param to an op with path params, run
codegen and both generated-package typechecks immediately. If the current
generator emits a collision, resolve the value server-side, make the
identifying param query-only, or use a distinct operationId.

## 2. Duplicate schema names fail opaquely
Python's `yaml.safe_load` silently keeps the LAST duplicate key, so the YAML
"validates", but orval fails with `Failed to resolve input: Please provide a
valid string value or pass a loader to process the input`.
**How to apply:** grep `SchemaName:` in lib/api-spec/openapi.yaml before
adding a component schema; trust orval's output over Python's silence.

## 3. Hand-patched generated clients drift
Endpoints hand-added to generated files are silently deleted by a clean orval
run — strict-ESM importers then crash the whole process at import time.
**How to apply:** add schemas to `openapi.yaml` first, never patch generated
files; intentional non-spec routes (plain-JSON, admin, redirect, SSE, media)
must be listed in `lib/api-spec/contract-exceptions.json` with a kind and
reason. The `api-contract` and `api-codegen-repro` gates enforce this.

## 4. Non-200 responses may be type-only
A 201/other non-200 inline response can produce only a generated TS model,
not a runtime Zod parser. Typecheck passes while a server import of the
expected parser fails after regeneration.
**How to apply:** verify generated/api.ts exports the runtime parser before
importing it; otherwise keep the response typed by the spec.

## 5. Adding query params shifts generated client arguments
An imperative fetcher changes from `(pathParam, requestOptions?)` to
`(pathParam, queryParams?, requestOptions?)`; the React hook similarly inserts
query params before hook options.
**Why:** existing second-argument object literals may still look reasonable but
become type errors, or can be interpreted as URL query values if structurally
compatible.
**How to apply:** grep every generated fetcher and hook call site after adding
the first query parameter. Shift request/hook options to the new final argument
and pass `undefined` for query params when the caller does not set them.
