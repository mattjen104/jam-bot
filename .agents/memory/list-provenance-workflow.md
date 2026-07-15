---
name: List provenance admin workflow
description: Four-table schema, scrape pipeline, and admin steps needed for "Listed on" provenance to appear in the NowPlaying panel.
---

## Tables (lib/db/src/schema/lore.ts, appended)
- `recording_release_groups` — bridge: recording MBID → release group MBID(s), cached title/year, isPrimary flag.
- `list_sources` — publication / selector / station that authors lists.
- `lists` — specific list (year-end, all-time, etc.), points to a source.
- `list_entries` — album-level entries with confidence (exact/fuzzy/unresolved) and confirmed flag.

## LLM seam
- `list-llm.ts` / `list-wire.ts` — same injectable pattern as schedule-llm/schedule-wire; uses `@workspace/integrations-anthropic-ai`.

## Admin workflow (all endpoints need `x-admin-token` header)
1. `POST /api/admin/list-sources` — create a source (publication name, kind, optional picker/station FK).
2. `POST /api/admin/lists/scrape` — fetches URL, LLM extracts entries, MB release-group search resolves each album, inserts into `list_entries`. Requires `MUSICBRAINZ_CONTACT` + Anthropic integration.
3. `POST /api/admin/recordings/enrich-release-groups` — body `{mbids:[...]}` (max 50). Queries `MB /recording/<mbid>?inc=release-groups`, caches in `recording_release_groups`. **Must be run before provenance appears in the UI.**
4. `PATCH /api/admin/lists/:listId/entries/:entryId` — confirm fuzzy/unresolved matches.

## Query
`GET /api/recordings/:mbid/list-provenance` joins:
`list_entries → lists → list_sources` INNER JOIN `recording_release_groups` on matching release_group_mbid AND recording_mbid.
Only `confidence='exact' OR confirmed=true` entries are returned.

## Why `recording_release_groups` must be seeded separately
List scraping gives us album → release_group_mbid.
The provenance endpoint needs recording_mbid → release_group_mbid.
These are different MB objects; the bridge must be populated by querying MB for the recording's releases (inc=release-groups). The endpoint does NOT lazy-populate (no MB calls on the hot path).

**Primary selection rule:** Album type + no secondary types + earliest first-release-date wins. Fallback: earliest date of any type.

## Frontend
`ListProvenance` component in `NowPlaying.tsx` (above `LinerNotes`). Uses `useGetRecordingListProvenance` hook. Returns null when items is empty (silent before data is seeded). staleTime = 15 min.
