---
name: Odesli links API endpoint
description: Correct Odesli/song.link links endpoint and the 404 trap from the old path
---

# Odesli (song.link) links API

The cross-platform links lookup endpoint is:

```
https://api.song.link/v1-alpha.1/links?url=spotify:track:<ID>&userCountry=US&songIfSingle=true
```

Response includes `linksByPlatform` (per-platform `{ url }`) and `pageUrl`.

**The trap:** the old/wrong path `https://api.song.link/v1-links` (and
`api.odesli.co/v1-links`) returns a plain-text `404 Not Found` served by
Fastly for **every** request — including the host root and the most famous
tracks. That makes it look like a deploy bug, a network/IP block, or
"these tracks aren't in Odesli", when it's actually just the wrong path.

**Why:** `v1-links` was never the real path; only `v1-alpha.1` is public.
A site-wide Fastly 404 (not JSON, not a per-entity 404) means the path is
wrong, not the entity.

**How to apply:** if Odesli lookups 404 uniformly, check the base path
first. No API key is required under ~10 req/min; `key` raises the limit.
Working endpoints on `api.odesli.co`: `/resolve` (echoes provider/id only)
and `/oembed` (iframe embed) — neither returns `linksByPlatform`, so don't
substitute them for the links lookup.
