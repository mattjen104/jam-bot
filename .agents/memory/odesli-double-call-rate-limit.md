---
name: Odesli double-call rate-limit
description: Why the API server must not call Odesli a second time during link unfurling, and the platforms pass-through pattern that fixes it.
---

## The rule

When the jam-bot unfurls a pasted music link it already calls Odesli once (in `resolveAnyUrl`). The API server (`/share/resolve/song`) must **not** call Odesli again for the same track. A second call from the production server IP hits Odesli's free-tier rate limit, returns a non-200 status, gets caught silently, and all links fall back to search-only.

**Why:** The symptom is completely invisible — no error log, no failed request from the caller's perspective — just every link being a search URL instead of a deep-link. The 0.5 s response time is the tell: fast enough that Odesli was hit (250 ms min delay) but returned immediately with a 429.

**How to apply:** Use the platforms pass-through pattern:

1. `resolveAnyUrl` in `lib/song-enrichment/src/odesli.ts` parses `linksByPlatform` and returns `platforms?: TrackLink[]` in `ResolvedSong`.
2. `linkUnfurl.ts` passes `resolved.platforms` in the POST body to `/share/resolve/song`.
3. The route handler validates and extracts `platforms[]` from the body.
4. `resolveSongShareOrLinks` accepts `platforms` and forwards it to every `buildLinksOnly` call-site as `preResolvedPlatforms`.
5. `buildLinksOnly` converts pre-resolved platforms to `kind: "exact"` links and merges search fallbacks only for services Odesli didn't return — never touching `fetchRecordingLinks` when `preResolvedPlatforms` is present.

If `platforms` is absent (direct API call, not via jam-bot), the existing `fetchRecordingLinks` path is still taken as a fallback.
