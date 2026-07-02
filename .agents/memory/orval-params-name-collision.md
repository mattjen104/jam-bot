---
name: Orval params name collision
description: Why an OpenAPI operation with both path and query params breaks the api-zod build.
---

# Orval `<Op>Params` name collision

An operation whose operationId is e.g. `getRecordingEntry` and that declares
BOTH a path parameter (`mbid`) AND a query parameter generates two different
symbols with the SAME name:
- `GetRecordingEntryParams` in `generated/api.ts` (the zod path-param validator)
- `GetRecordingEntryParams` in `generated/types/` (the query-params TS type)

The api-zod barrel does `export * from "./generated/api"` and
`export * from "./generated/types"`, so the two collide:
`TS2308: Module "./generated/api" has already exported a member named ...`.

Operations with only path params (spins, segues) do NOT collide because no query
type is generated.

**Why:** orval derives both symbol names from the operationId; it has no
disambiguation across the two output folders.

**How to apply:** avoid declaring a query parameter on an operation that already
has path params. Prefer resolving the value server-side (e.g. the entry ladder
looks up the recording's `artistMbid` from the DB instead of taking it as a
query param). If a query param is truly required, rename via a distinct
operationId or post-process the codegen.
