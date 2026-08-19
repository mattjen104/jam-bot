---
name: Drizzle CTE raw-column aliases
description: How to safely reuse computed raw SQL fields in Drizzle CTEs.
---

Raw SQL expressions selected into a Drizzle CTE must use an explicit `.as(...)` alias before a downstream CTE or query can reference them.

**Why:** Drizzle does not infer a database column name for a raw SQL selection. Referencing an unaliased field through the CTE proxy fails at runtime even when TypeScript accepts the property name.

**How to apply:** Alias computed values such as normalized artist names at their `select` / `selectDistinct` definition. When an aggregate repeats the same listener taste predicates across many score filters, name those taste slices as shared CTEs so PostgreSQL can reuse the sets instead of repeatedly scanning the active audience.