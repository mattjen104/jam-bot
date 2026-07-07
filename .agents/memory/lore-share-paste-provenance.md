---
name: Lore share/paste provenance rule
description: How the jam-bot link-unfurl paste path decides lore vs links-only, and when it defensively writes to recordings.
---

# Paste-to-share provenance

`resolveSongShareOrLinks` (api-server `src/lore/share.ts`, called by jam-bot's
Slack link unfurler via `POST /share/resolve/song`) resolves a pasted music link
to either a full **lore** card or a **links-only** card.

**Normal path never writes:** `spins.mbid` has a FK to `recordings.mbid`
(`spins_mbid_recordings_mbid_fk`), so a spin cannot exist without its recording.
"Aired on a Lore station" ⟹ "already in `recordings`". A pasted song with any
station history is found by the ingest pipeline FK — returned as `kind:"lore"`.
Anything not in the library never aired → `kind:"links-only"`, no write.

**Defensive integrity-gap path (step 3b) does write:** After `getSongShare(mbid)`
returns null (no recordings row), `getMbidStationHistory(mbid)` queries `spins`
directly. If history exists (live or ghost), the ingest pipeline has an integrity
gap. The function upserts from available metadata (title/artist/isrc/artworkUrl)
and returns the full Lore card. This path should never fire in a healthy system
and emits a `console.warn` when it does.

**Station-history helper:** `getMbidStationHistory(mbid)` is extracted so both
`getSongShare` (normal) and `resolveSongShareOrLinks` (defensive) share the same
live+ghost spins queries without duplication.

**Control flow:**
1. `resolveSongShareByIds` — DB-first by spotifyTrackId/isrc/artist+title → lore
2. `resolveToMbid` — only if artist+title OR isrc present; no mbid → links-only
3. `getSongShare(mbid)` — if recording exists → lore
3b. `getMbidStationHistory(mbid)` — if history despite missing row → upsert + lore
4. links-only, no write

**Contract:** at least one strong identifier required — artist+title, spotifyTrackId,
or isrc. A bare Spotify id without metadata yields cross-service links (incl. Qobuz)
via `buildLinksOnly`.
