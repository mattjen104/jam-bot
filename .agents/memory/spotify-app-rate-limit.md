---
name: Spotify app-wide rate limit vs casting
description: Why interactive Spotify playback breaks when background pollers hammer search, and the cooldown design
---

Spotify rate-limits per APPLICATION (client id, rolling ~30s window), across ALL
tokens — client-credentials AND user OAuth tokens share the bucket. So heavy
background usage (hundreds of station pollers using Spotify text-search as an
MBID-resolution fallback) can 429 the whole app and silently break interactive
features: casting/play, saved-check, recently-played.

**Why:** Live-radio casting kept failing with WebapiError "[object Object]"
(spotify-web-api-node masks 429 bodies) while unit tests were green — the
failure was quota exhaustion by unrelated jobs, not the play path.

**How to apply:**
- The app-level client (`spotify/appClient.ts`) has a global cooldown: any 429
  sets `cooldownUntilMs` (respects Retry-After, min 60s) and `getClient()`
  returns null during cooldown so best-effort enrichment degrades to
  null/empty instead of hammering.
- Play-time track resolution passes the LISTENER'S token to
  `resolveSpotifyTrack` — but remember this does NOT escape the app-wide
  bucket; the cooldown is the real fix.
- User-token search failures must throw honest SpotifyPlayError (never map an
  upstream 4xx/5xx to "track not found"); market-scoped user-token search
  results are never cached by mbid.
- Diagnose via server logs: `WebapiError [object Object]` = spotify-web-api-node
  429/4xx; check for concurrent `recently-played failed (429)` lines to spot
  app-wide throttling.
- Penalties can be EXTENDED: we once got Retry-After 47599s (~13h). During a
  penalty EVERYTHING 429s including user-token playback — nothing to do but
  wait; the cooldown honors the full Retry-After.
- Prevention: all app-client calls also go through a global pacing queue
  (400ms min start gap, `paced()` in appClient) and re-check cooldown after
  dequeuing; UI distinguishes rate_limited/spotify_error from a true 404 so
  "Not on Spotify" is never shown for quota failures.
