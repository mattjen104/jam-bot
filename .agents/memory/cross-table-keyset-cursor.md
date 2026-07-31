---
name: Cross-table keyset cursor for name sorts
description: When unioning two tables in a paginated library endpoint, the cursor tiebreak must be a column present in both tables (addedAt), not a single-table field (mbid).
---

## Rule
When paginating a JS-merged union of two tables (e.g. `library_items` + `spotify_library_items`) with a keyset cursor, the tiebreak in the cursor must be a field that exists in **both** tables. Using `mbid` as the tiebreak works only for resolved rows and silently drops soft rows on pages 2+.

**How to apply:** Use `(sortKey, addedAt)` as the cursor tuple for name sorts. Cursor format: `sortKey\x1faddedAt.toISOString()`. Both tables have `addedAt`. Apply `(sortKey, addedAt) > (keyPart, addedAtPart::timestamptz)` to each table independently. The DB ORDER BY for name sorts must also include `addedAt ASC` as the second column to match cursor semantics.

**Why:** Without a shared tiebreak column, page cuts are non-deterministic when two rows share the same sort key, causing duplicates or skips across pages.

## Backward compat
Old cursors used `sortKey\x1fmbid` (UUID). Detect: `/^\d{4}-\d{2}-\d{2}T/.test(suffix)`. Old sessions fall through to a graceful legacy path (resolved-only cursor, soft rows restart from top).
