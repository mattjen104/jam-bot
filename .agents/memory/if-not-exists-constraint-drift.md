---
name: IF NOT EXISTS migrations can't repair constraint drift
description: ON CONFLICT upserts failing with "no unique or exclusion constraint" — boot DDL silently skips PKs on pre-existing tables
---

# CREATE TABLE IF NOT EXISTS migrations can't repair constraint drift

The rule: a boot migration built on `CREATE TABLE IF NOT EXISTS (… PRIMARY KEY …)` only guarantees the constraint on a **fresh** database. If the table already exists (created earlier by drizzle push, a partial run, or a manual restore) without the PK, the migration silently skips it forever — and every `ON CONFLICT (cols)` upsert against it fails at runtime with "no unique or exclusion constraint matching the ON CONFLICT specification".

**Why:** the dev DB's attendance rollup tables existed with their secondary indexes but no primary keys, so the whole attendance heartbeat write path failed in the DB test suite. The boot migration ran clean on every boot ("OK") because IF NOT EXISTS made it a no-op — the drift was invisible until the upsert errors surfaced.

**How to apply:**
- When a suite fails with ON CONFLICT errors on a table a boot migration "owns", check `pg_constraint` first: `SELECT conname FROM pg_constraint WHERE conrelid='<table>'::regclass AND contype IN ('p','u');` — don't assume the migration shape matches reality.
- Repair is a one-line `ALTER TABLE … ADD CONSTRAINT … PRIMARY KEY (…)` (fails loudly if duplicates exist, which is what you want).
- If a migration must be drift-proof, add an explicit constraint check + ADD CONSTRAINT step rather than relying on the CREATE TABLE definition.
- Remember other environments (production) may carry the same drift even after dev is fixed.
