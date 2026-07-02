---
name: drizzle-kit push + NULLS NOT DISTINCT drift
description: drizzle-kit 0.31 doesn't introspect NULLS NOT DISTINCT, so a nullsNotDistinct() unique constraint causes permanent push drift.
---

# drizzle-kit 0.31 does not introspect NULLS NOT DISTINCT

Adding `unique(...).nullsNotDistinct()` (or a NULLS NOT DISTINCT unique index) to
a drizzle schema makes `drizzle-kit push` report the constraint as missing on
EVERY run, even right after you created it. It then tries to `ADD CONSTRAINT`
with a name that already exists and fails.

**Why:** drizzle-kit 0.31.9 does not read `pg_index.indnullsnotdistinct` during
introspection (grep the dist: no reference). So the introspected state (which it
reads as a plain NULLS-DISTINCT unique) never matches the desired
`nullsNotDistinct` schema, producing a false-positive diff forever. This project
uses `pnpm push` (no migration files), so the drift would poison push for the
whole monorepo, not just one table.

**How to apply:** avoid `nullsNotDistinct()` in the schema on this toolchain. If
you need null-inclusive dedup, prefer a design where the key columns are NOT
NULL, or reconsider whether the nullable column belongs in the unique key at all
(often a nullable column is functionally dependent on the others and can be
dropped from the key). If you truly must have NULLS NOT DISTINCT, apply it with
raw SQL and accept that `push` will not track it — but that breaks the push
workflow, so treat it as a last resort.

Related: for Lore's `segue_edges`, show_id was left OUT of the unique key
precisely to dodge this — see lore-resolution-ordering.md.
