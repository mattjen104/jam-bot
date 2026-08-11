---
name: CREATE TABLE IF NOT EXISTS never repairs constraints
description: Boot migrations using IF NOT EXISTS silently skip PK/constraint additions on tables that already exist — ON CONFLICT then fails with 42P10.
---

# CREATE TABLE IF NOT EXISTS never repairs constraints

**Rule:** a PK/unique constraint needed by an ON CONFLICT upsert must have its own idempotent migration step (ALTER TABLE / CREATE UNIQUE INDEX IF NOT EXISTS) — never rely on the constraint inside a `CREATE TABLE IF NOT EXISTS` block.

**Why:** IF NOT EXISTS checks only table existence, so a table created by an earlier revision (or push drift) keeps its old shape forever; every upsert then fails with PG 42P10 while the migration source looks correct and fresh-DB CI stays green.

**How to apply:** on a 42P10, `\d` the live table vs the migration's CREATE TABLE; expect a missing PK/unique index. Verify no duplicate rows exist, then ALTER TABLE ADD PRIMARY KEY.
