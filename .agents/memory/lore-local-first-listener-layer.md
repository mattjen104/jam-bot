---
name: Lore local-first listener layer
description: Journal + follows are device-local localStorage stores by design; no accounts, feed composed client-side.
---

**Rule:** The listener's own layer (listening journal, follows/Following feed) is local-first: localStorage stores exposed via useSyncExternalStore hooks, no server writes, no accounts. The Following feed fans out client-side to existing per-station/per-picker archive endpoints rather than adding a backend feed endpoint.

**Why:** Chosen deliberately for Phase 6 — zero signup friction fits the "best free radio" thesis, and follow counts are small enough that client fan-out is fine. Also keeps privacy honest ("stored only on this device" is stated in the UI copy).

**How to apply:** If accounts/sync arrive later, migrate these stores (keys `lore:journal:v1`, `lore:follows:v1`) instead of silently replacing them, and keep the on-device promise in the UI truthful. Don't add a backend feed endpoint until fan-out actually hurts.

**Journal correctness lessons (from architect review):**
- The logger effect's trigger key must be at least as wide as the dedup identity: include station|playedAt|mbid|title|artist, or artist-only transitions get silently dropped.
- Dedup lives in appendJournal (30-min window vs newest entry) so re-reports from polling/status flaps collapse, while a re-listen later logs again.
- Feed sorting must normalize mixed date shapes (day-only `YYYY-MM-DD` vs full ISO) to numeric timestamps; string localeCompare across shapes is fragile.
