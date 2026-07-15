---
name: NowPlaying confidence enum must include all server values
description: The server stores client-reported spins with confidence='spotify', which must be in the openapi.yaml enum or the Zod parse crashes every now-playing poll.
---

The `NowPlaying.confidence` field has an enum in openapi.yaml. The server also accepts `confidence: 'spotify'` from client-reported now-playing (the `/stations/:slug/report-now-playing` endpoint stores it directly). If `spotify` is absent from the enum, `ListStationsNowPlayingResponse.parse({ items })` throws a ZodError on every poll cycle, crashing the now-playing route for the entire station batch.

**Why:** The Zod validator is generated from openapi.yaml. The enum must cover every value the server can actually store, including ones that come from client-reported paths rather than the server-side resolution pipeline.

**How to apply:** The full confidence enum in openapi.yaml must be: `[recording_id, isrc, text, unresolved, spotify]`. There are 6 occurrences (NowPlaying schema is inlined in several response schemas) — update all of them together. Use `sed -i 's/enum: \[recording_id, isrc, text, unresolved\]/enum: [recording_id, isrc, text, unresolved, spotify]/g'` to hit all at once.
