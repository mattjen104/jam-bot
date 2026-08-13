---
name: Lore device-identity fork
description: "Missing library" in Stack is usually a forked anonymous session, not a data/query bug — diagnose via lore_users last_seen_at vs library_items ownership.
---

**Rule:** When a listener reports their library/Stack is empty but the data exists in `library_items` / `spotify_library_items`, suspect a forked device identity before suspecting the feed query. Lore auto-provisions an anonymous `lore_users` row per `lore_sid` cookie; any cookie loss (cleared storage, new browser profile, preview-pane origin change) silently creates a fresh empty user, and every `/api/me/*` call succeeds — returning an honest empty library.

**Diagnosis:** compare `lore_users.last_seen_at` (the row updated seconds ago is the active browser session) against which `user_id` actually owns the library rows. Server logs like `[crossings] background recompute for user=<id>` also reveal the live session's user id.

**Fix without Spotify reconnect:** swap `device_key`s — park the throwaway user's key on a random value, then set the original user's `device_key` to the key the browser is currently sending. The existing cookie then resolves to the real identity on the next request. (Normal recovery path is the Spotify OAuth callback's `recoverUserByServiceId`, keyed on `service_connections.external_user_id`, but that requires the user to reconnect.)

**Why:** identity is cookie-only by design (no login wall); recovery anchors exist only for connected services, so cookie loss with no reconnect has no self-service recovery path.
