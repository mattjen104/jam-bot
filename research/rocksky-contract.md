# Rocksky compatibility contract

Verified against Rocksky's public repository and API on 2026-09-18.

## Confirmed interfaces

- Public AppView base: `https://api.rocksky.app/xrpc`.
- `app.rocksky.song.getSong` accepts an `at://` URI, MBID, ISRC, or Spotify ID.
- `app.rocksky.song.matchSong` requires artist and title and optionally accepts
  album, MusicBrainz recording ID, and ISRC anchors.
- `matchSong` is a shared, rate-limited AppView operation with a ten-second
  server budget and a 24-hour result cache.
- Song responses may include an `at://` URI, MBID, ISRC, artist, title, album,
  duration, and Spotify, Apple Music, Tidal, and YouTube links.
- A song is described as canonical within the owning user's repository. This
  does not establish one globally canonical Rocksky record per recording.
- AT Protocol records remain controlled by their repositories and therefore
  may be updated or deleted.

## Deployed behavior observed

- A documented MusicBrainz recording ID returned a public song successfully.
- Missing MBIDs returned HTTP 500 with `InternalServerError`, although the
  current source intends to return a typed `NotFound` error. The first study
  therefore classifies these as unavailable rather than silently calling them
  confirmed misses.
- A documented ISRC returned a different live edition from the MBID lookup
  while retaining the same ISRC and Spotify URL. ISRC agreement alone is not
  sufficient to choose an edition or recording without conflict checks.

## Experiment policy

- Use `getSong` for independent MBID and ISRC coverage measurements.
- Do not call `matchSong` in the first pass; its provider search can obscure
  direct-identifier coverage and consumes a separate shared rate budget.
- Do not create Rocksky records.
- Do not write lookup results to Lore's database.
- Preserve Lore observations and resolution claims independently of Rocksky.
- Treat Rocksky URIs as external references, not Lore's identity authority.

## Sources

- Rocksky `LEXICONS.md`
- `apps/api/lexicons/song/getSong.json`
- `apps/api/lexicons/song/matchSong.json`
- TypeScript SDK `src/client.ts`
- AppView `song/matchSong.ts`
- Live `app.rocksky.song.getSong` response for a documented MusicBrainz ID
