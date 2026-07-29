---
name: Library export & spin provenance
description: File-export honesty rules, provenance.kind forcing, spinId link, and ISRC enrichment job for the listener library.
---

# Library export & spin provenance

- Export formats live as pure builders (`lore/library-export.ts`); the endpoint runs ONE provenance-joined query, no inline MB lookups. Honesty rule: missing fields export empty (CSV) / null (JSON) — never fabricated. CSV header is exactly `title,artist,album,isrc`.
- **provenance.kind is forced server-side to "keep"** on both keep paths (`{ ...override, kind: "keep" }` — spread FIRST). Clients historically sent `kind:"station"` which leaked into storage; those rows were normalized. UI must key off `stationSlug`/`service` presence, not kind.
- `library_items.spinId` links keeps to real air history; on the mbid keep path it is only stored when `spins.mbid = mbid` (never persist mismatched provenance).
- ISRC enrichment: isolated MB resolver chain (`fetchIsrcByMbid`, `/recording/{mbid}?inc=isrcs`), `recordings.isrcCheckedAt` marks attempts so misses aren't refetched; job idles on a slow tick instead of exiting because keeps arrive forever.

**Why:** exports are the portability promise — a fabricated album/ISRC silently corrupts users' data in other services.
**How to apply:** any new export field or import round-trip (JSON `lore.library.v1`) must keep null-honesty and go through the pure builders + boot-time idempotent migration (`library-export-migration.ts`) for schema additions — schema edits alone break existing DBs.
