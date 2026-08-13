---
name: Book-backed knowledge conventions
description: Design decisions for the curated book source layer (sourceHandle "book") that future book/knowledge work must stay consistent with.
---

# Book-backed knowledge conventions

- **Rule:** Book facts reuse `track_claims` with `sourceHandle: "book"`; no new table. `sourceLabel` carries `"Book title — Author"` (em-dash separator) and both server (`recordings.ts` sources map) and UI (`AlbumInvestigationSheet`, `linerNotes.ts`) split on that em-dash to surface the author separately. Changing the separator breaks author extraction in three places.
- **Rule:** Stored text must be a short *original* paraphrase — `textIsOriginalSummary` rejects >600 chars and long fully-quoted blocks; the linked book page is the evidence, never hosted excerpts.
- **Rule:** Grounding is mandatory for publication: a fact intended `published` but missing its book URL is demoted to `draft` at ingest (DB `source_url` is non-null, so an empty string is stored and both server and UI treat `"" → null` for links). Drafts are reviewed via the existing `PATCH /admin/claims/:id` semantics.
- **Rule:** External IDs are deterministic `book:{sourceSlug}:{factIndex}` with `onConflictDoNothing` — re-ingest is idempotent; boot runs `ingestAllBookSources()` alongside the other picker seeds.
- **Why:** Copyright safety (paraphrase-only, link-out evidence) and the spins→recordings FK model (facts only attach to recordings already on the spine; unknown MBIDs are skipped, never planted).
- **How to apply:** When adding books, edit `CURATED_BOOK_SOURCES`; catalogue invariant tests validate every entry (unique slugs, https links, summary guard, uuid MBIDs) automatically. Coverage level (artist/album/recording) is metadata only for now — everything still targets a representative recording MBID.
