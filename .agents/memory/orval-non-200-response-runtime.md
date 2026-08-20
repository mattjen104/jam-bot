---
name: Orval non-200 response runtime schemas
description: Orval's Zod output treats some non-200 inline responses as type-only models rather than runtime parsers.
---

When a server handler needs a runtime Zod parser, do not assume an OpenAPI response with status 201 will produce a runtime export named after the operation. Verify generated/api.ts; non-200 responses can produce only a generated TypeScript model.

**Why:** The generated client contract can typecheck while a server import of the expected response parser fails after regeneration.

**How to apply:** Prefer the generated runtime parser when it exists; otherwise keep the response typed by the spec and avoid reintroducing a hand-maintained parser solely for a non-200 response.