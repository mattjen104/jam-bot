---
name: Lore share/paste provenance rule
description: Why the jam-bot link-unfurl paste path never writes to recordings, and how it decides lore vs links-only.
---

# Paste-to-share never persists

`resolveSongShareOrLinks` (api-server `src/lore/share.ts`, called by jam-bot's
Slack link unfurler via `POST /share/resolve/song`) resolves a pasted music link
to either a full **lore** card or a **links-only** card. It NEVER writes to
`recordings` on the paste path.

**Why:** `spins.mbid` has a FK to `recordings.mbid` (`spins_mbid_recordings_mbid_fk`),
so a spin cannot exist without its recording. Therefore "aired on a Lore station"
⟹ "already in `recordings`". A pasted song that has any station history is
already persisted by the ingest pipeline and is found as an existing recording
(returned as `kind:"lore"`). Anything not already in the library never aired, so
it's `kind:"links-only"` with no write. A manual upsert-on-paste branch would be
unreachable dead code — and not writing at all is the strictest, safest reading
of the product rule "DO NOT persist a pasted song unless it played on a station."

**How to apply:** Don't add an upsert/insert to this path. Control flow is:
(1) `resolveSongShareByIds` DB-first by spotifyTrackId/isrc/text → lore;
(2) `resolveToMbid` (only if artist+title OR isrc present) → if no mbid, links-only;
(3) `getSongShare(mbid)` → if the recording exists, lore; else links-only.

**Contract:** the route/jam-bot require at least one strong identifier — artist+title,
OR spotifyTrackId, OR isrc — not artist+title unconditionally (honor "paste ANY
link": a bare Spotify id still yields cross-service links incl. Qobuz).
