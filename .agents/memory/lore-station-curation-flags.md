---
name: Lore station curation flags (favorite/hidden)
description: How favorite/hidden station flags gate watchers, polling, and every listener-facing surface.
---

# Station curation flags

- `stations.favorite` — only favorite `radio_browser_icy` stations get a persistent ICY watcher; all other pollable stations interval-poll. Soft budget 40 (UI warning only, never enforced server-side).
- `stations.hidden` — soft-hide: excluded from discovery/list reads and polling stops entirely (boot skip + enroll no-op). Row/spins/radio_browser link kept for one-click reintroduce. Distinct from health-driven `active`.
- Restoring a permanently removed curated station must re-enroll its poller after the DB transaction commits; changing `hidden` and `active` alone leaves the live process unaware until restart.

**Why:** persistent connections are a scarce bandwidth budget; deleting stations breaks FKs, so hide must be soft.

**How to apply:**
- Any NEW listener-facing discovery query must add `hidden = false` (and usually `active = true`). There is no central visibility predicate, so leaks are easy: gate list endpoints and client-write paths alike.
- The explicit current-set lookup is the exception: an already-tuned or cached station may become hidden mid-session, and its stored set must remain readable so the player does not falsely report “no history.” This does not restore it to discovery.
- Flag flips live-apply via poller re-enrollment (unenroll first, no-op when hidden, watcher iff favorite ICY) — no restart needed.
- For a restore flow, return the updated station from the transaction and call `enrollStationPoller` only after commit, so the first poll sees its visible state.
- Admin flags endpoints are plain JSON, deliberately outside OpenAPI/orval (regen risk); admin UI uses plain fetch + x-admin-token.
- Admin router rate limit (10 req/15min) will 429 curl test bursts — flip flags directly in the DB when testing.
- LORE_ADMIN_TOKEN must live in Replit Secrets only; setting it as a dev env var writes the value into repo-tracked `.replit` (flagged as a credential leak).
