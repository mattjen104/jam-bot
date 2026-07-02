---
name: Postgres NUL in text columns
description: Postgres rejects the NUL byte (U+0000) in text columns; never use it as a separator in DB keys.
---

# Postgres rejects NUL (U+0000) in `text` values

Inserting/selecting a `text` value containing a NUL byte (`\u0000`) raises
Postgres error `22021` (`report_invalid_encoding`, `routine: report_invalid_encoding`,
`file: mbutils.c`) — even though NUL is a valid JS string char.

**Why this bit us:** the lore `resolveToMbid` resolution-cache key joined
normalized `artist` + `title` with `\u0000`. Every cache read AND write threw
`22021`, and both call sites wrapped the query in a silent `try/catch` — so the
cache stayed permanently empty with zero log noise. Symptom was "cache never
populates" while spins still ingested fine (spin rows don't use the NUL key).

**How to apply:** never use `\u0000` as a delimiter in any value destined for a
Postgres `text`/`varchar` column. Use a non-alphanumeric control char that's
still valid in text, e.g. Unit Separator `\u001f`. When the joined halves are
already normalized to `[a-z0-9 ]`, any such separator is collision-safe. In-memory
JS `Map` keys can still use `\u0000` freely (e.g. segue.ts grouping keys) — the
rule only applies to values that hit Postgres.

**Debugging tip:** a silently-empty cache/table with working surrounding writes +
a `try/catch` around the query = suspect a swallowed DB exception. Reproduce the
exact insert in a standalone `tsx` script (wrap in `async function main(){...}` —
tsx's CJS output rejects top-level await) to surface the real error.
