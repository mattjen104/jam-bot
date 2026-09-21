---
name: Canonical album provider playback
description: Trust, authorization, and lifecycle rules for provider-native playback on canonical album pages.
---

Canonical album playback capabilities come only from durable release-group mappings that are exact, explicitly verified, live, and provider-URL validated. Request paths project stored evidence only; they never search providers or infer album identity from titles, collection links, or track-level guesses.

**Why:** Parallel legacy links and permissive iframe URLs can bypass the canonical evidence gate. Provider authorization is also narrower than a saved account connection: Spotify browser playback requires the scopes actually granted by OAuth, Premium eligibility, and a Web Playback SDK device created after a user gesture.

**How to apply:** Keep provider tokens out of album payloads and logs. Derive safe official embed URLs from validated IDs where possible. Require complete ordered exact mappings for album queues. Keep each provider SDK session independent from Lore radio, invalidate async work on close/switch, and retain verified external/embed fallbacks.