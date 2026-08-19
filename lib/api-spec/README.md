# @workspace/api-spec — OpenAPI contract for the Lore API

`openapi.yaml` is the source of truth for the typed API surface. Orval
generates two clients from it:

- `lib/api-client-react/src/generated/` — fetchers + React Query hooks
- `lib/api-zod/src/generated/` — zod schemas (used server-side for validation)

**Never hand-edit anything under a `generated/` directory.** A clean codegen
run will delete it, and strict-ESM imports of the vanished export crash the
server at boot. If you need a schema for an endpoint that is intentionally
outside the spec, hand-maintain it in `lib/api-zod/src/patches.ts` (and delete
it from there once the endpoint lands in the spec — the checker enforces this).

## Commands

| command | what it does |
| --- | --- |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate both clients from `openapi.yaml` and typecheck them. |
| `pnpm --filter @workspace/api-spec run check` | Contract check + regression fixtures. Fails on any drift. |
| `pnpm --filter @workspace/api-spec run check:generated` | Reproducibility gate: runs codegen once in an isolated temp mirror of the repo and fails unless its output is byte-identical to the checked-in generated clients. Never writes to the live workspace, so it is safe to run in parallel with other checks. |

`check` runs in the workspace validation flow as the `api-contract` step.

## What the contract check compares

Three surfaces must agree:

1. **Shipped routes** — every `router.METHOD("path", ...)` under
   `artifacts/api-server/src` (routes/ files plus out-of-tree helper modules
   they mount, e.g. `lore/apple-library-batch-endpoint.ts`).
2. **The contract** — paths + methods + operationIds in `openapi.yaml`.
3. **Generated code** — fetcher exports in the generated React client and
   schema exports in the generated zod client, plus the `patches.ts` seam.

## Failure classes

| class | meaning | fix |
| --- | --- | --- |
| `[missing-contract]` | A shipped route is in neither the spec nor the exceptions file. | Add the operation to `openapi.yaml` (preferred) **or** add a documented entry to `contract-exceptions.json`. |
| `[spec-without-server]` | An operation is declared in `openapi.yaml` but no server route implements it. | Fix the path in the spec, implement the route, or remove the operation. |
| `[stale-exception]` | An exceptions-file entry no longer matches a shipped route. | Delete the entry (or move the route back). |
| `[missing-generated]` | A spec operationId has no export in the generated clients. | Run `codegen`. If it persists, the spec YAML is malformed for that operation. |
| `[generated-not-in-spec]` | The generated client exports a fetcher with no matching operationId — the hand-patch drift mode. | Declare the operation in `openapi.yaml` and regenerate; never hand-patch generated files. |
| `[patch-collision]` | `patches.ts` re-declares a schema the generated zod client already exports. | Delete the duplicate from `patches.ts`. |
| `[duplicate-route]` | The same method+path is registered twice (a merge-splice symptom). | Remove the duplicate registration. |

## Intentional exceptions (`contract-exceptions.json`)

Not every route belongs in the OpenAPI contract. The exceptions file documents
each excluded route with a `kind`:

- `plain-json` — hand-written fetch read models (the `/api/player/*`
  webplayer surface, `/api/me/*` ledger/library endpoints, etc.). Deliberate;
  no orval client wanted.
- `admin` — ops-only admin endpoints. Several have hand-maintained zod schemas
  in `patches.ts` for server-side validation.
- `redirect` — OAuth/browser-navigation endpoints (`/spotify/login`, connect
  start/callback). Not JSON APIs.
- `sse` — Server-Sent Events streams (`/stations/now-playing/stream`, replay
  progress, bottle stream).
- `media` — binary/HTML responses (share pages, card.png images, artwork and
  stream relays, file exports).

To add a new exception, append `{ "method", "path", "kind", "reason" }` to the
file. Paths use OpenAPI form (`{param}`; `*` matches a template-literal route
segment, e.g. the `/share/${kind}/:id` loop). The check fails if an entry goes
stale, so the file cannot rot.

## Adding a new endpoint

1. Declare it in `openapi.yaml` with an `operationId` and response schema
   (watch for duplicate schema names — YAML silently keeps the last one, but
   orval fails to resolve the input).
2. Implement the route on the server.
3. Run `codegen`, then `check`.
4. If the endpoint is genuinely not contract material (SSE, redirect, media,
   plain-JSON read model, admin-only), add an exceptions entry instead of a
   spec declaration — and say why in `reason`.
