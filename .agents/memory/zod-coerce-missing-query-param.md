---
name: zod.coerce missing query param
description: Generated zod query schemas with zod.coerce.string() turn an absent param into the string "undefined", silently passing min(1).
---

Generated (orval-style) query-param schemas use `zod.coerce.string().min(1)`. When the query param is absent, `req.query.x` is `undefined`, and `coerce.string()` yields the literal string `"undefined"` — which passes `.min(1)` and every downstream check, so a required param is never rejected.

**Why:** Found when a "400 when mbids missing" test returned 200 — the route happily queried for the mbid `"undefined"`.

**How to apply:** For every required query param validated via a generated coercing schema, add an explicit presence guard before safeParse: `if (typeof req.query["x"] !== "string") return 400`. Don't trust `.min(1)` to catch absence.
