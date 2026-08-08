---
name: Library timeline & lens model
description: Durable decisions behind the Library mixed timeline — server-derived dual-source labels and tie-safe keyset paging for merged multi-table feeds.
---

- **Dual-source ("kept + also imported") must be server-derived.** A keep upsert overwrites row provenance, so the "also imported" fact only exists as an import trace elsewhere; a client-side page-local merge splits duplicates/labels across page boundaries and was rejected in review. **How to apply:** any "same track from two sources" label comes from the API, never from folding paginated client rows.
- **Merged multi-table feeds need a unique secondary sort key.** Timestamp-only cursors skip rows on ties; the tie-break key must be each row's own identifier compared identically in SQL (`COLLATE "C"`) and in the JS merge (code-unit compare), and tie tests must span both source tables.
- Lens choice is a single URL param (`?lens=`) replacing separate source/view params; From Lore is a client-side provenance filter over keep rows.
