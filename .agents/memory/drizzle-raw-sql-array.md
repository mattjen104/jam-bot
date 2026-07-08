---
name: Drizzle raw-SQL array binding
description: How to pass integer arrays into raw sql`` template tags for ANY() in Drizzle ORM 0.45
---

When using Drizzle's `sql` tagged template, passing a JS array as a single interpolation (e.g. `${ids}`) generates a tuple `($1, $2, ...)`, not a PostgreSQL array. This breaks `= ANY(...)`.

**Correct pattern:**
```typescript
import { sql } from "drizzle-orm";

WHERE id = ANY(ARRAY[${sql.join(ids, sql`, `)}]::integer[])
```

- `sql.join(ids, sql\`, \`)` expands to `$1, $2, ...` (comma-separated params)
- Wrapping in `ARRAY[...]` produces a real PostgreSQL array literal
- `::integer[]` cast is required because Drizzle binds each param as `text` by default

**What NOT to use:**
- `sql.array()` — does not exist in drizzle-orm@0.45
- `${ids}` directly — generates `($1, $2, ...)` tuple, causes `op ANY/ALL (array) requires array on right side`

**Why:** Drizzle's `sql` template doesn't have a native array-binding helper at this version; the `ARRAY[sql.join]` trick is the codebase's established convention (see `recordings.ts` for the canonical example).

**How to apply:** Anywhere a raw `sql` query needs `ANY(array)`, use the `ARRAY[${sql.join(ids, sql\`, \`)}]::type[]` form.
