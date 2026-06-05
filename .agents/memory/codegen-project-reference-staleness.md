---
name: codegen → project-reference staleness
description: Why new OpenAPI/codegen schema members fail to resolve in consumers that import the client via a TS project reference, and the required rebuild step.
---

# New codegen schema members don't resolve in project-reference consumers

After editing `lib/api-spec/openapi.yaml` and running the client codegen, the new
fields/types land in the generated **source** (`lib/api-client-react/src/generated/*`).
But artifacts that consume the client through a **TypeScript project reference**
(e.g. `artifacts/music-graph/tsconfig.json` has `references: [{ path: "../../lib/api-client-react" }]`)
do NOT read that source — they read the lib's **emitted `.d.ts` in `dist/`**, because
the lib's tsconfig is `composite: true` + `emitDeclarationOnly` + `outDir: dist`.

So immediately after codegen, the consumer typecheck fails with a confusing split:
*old* schema members (`Credit`, `TrackInsight`) resolve fine, but the *newly added*
ones (`SongRelationship`, `TrackKnowledge.relationships`) report "no exported member"
/ "property does not exist" — even though they're clearly in the source.

**Why:** the stale `dist/*.d.ts` + `tsconfig.tsbuildinfo` predate the codegen change.

**How to apply:** after any OpenAPI/codegen change, run `pnpm run typecheck:libs`
(`tsc --build`) to rebuild the composite declarations BEFORE typechecking any
consuming artifact. Generic rule: codegen + lib-declaration rebuild must happen in
lockstep, or project-reference consumers see a half-updated client.
