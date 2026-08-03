---
name: Album-cover listener identity
description: Rules for anonymous album-cover identities and privacy-limited station presence.
---

Album-cover identity is a property of the existing anonymous Lore device identity, never a replacement for the historical emoji avatar on bottles.

**Why:** Bottle notes snapshot their emoji provenance and must remain readable; listener presence must be useful without becoming a profile or exposing device identity.

**How to apply:** Accept only a canonical recording identifier from clients, resolve artwork and metadata from Lore's catalogue server-side, and return only aggregate station counts at ten or more distinct active users. Below that threshold, expose anonymous cover tokens without user IDs, handles, or mappings. Keep a selected cover stable throughout a listening visit; only consider rotation at a visit boundary and never while a listener session is active.
