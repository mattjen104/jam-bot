---
name: Apple MusicKit replay boundary
description: Browser-only Apple Music replay uses exact server materialization IDs and stays independent from Lore's live/player state.
---

The Apple Music replay surface may receive only the short-lived developer token, public storefront, and exact manifest-order track IDs. It must load MusicKit in the browser, preserve unresolved/unavailable/dead receipt rows, and tear down its own queue/listeners without calling PlayerProvider.

**Why:** Lore must not host or proxy Apple audio, leak Apple signing credentials, mutate the immutable broadcast manifest, or let replay playback interfere with live radio.

**How to apply:** Keep Apple Music queue construction and MusicKit lifecycle in the replay surface/lib; leave guided replay as the honest fallback whenever configuration, authorization, entitlement, or exact coverage is unavailable.