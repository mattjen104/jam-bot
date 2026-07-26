---
name: Lore station curation flags (favorite/hidden)
description: How favorite/hidden station flags gate watchers, polling, and every listener-facing surface.
---

# Station curation flags

- `stations.favorite` — only favorite `radio_browser_icy` stations get a persistent ICY watcher; all other pollable stations interval-poll. Soft budget 40 (UI warning only, never enforced server-side).
- `stations.hidden` — soft-hide: excluded from ALL listener-facing reads AND polling stops entirely (boot skip + enroll no-op). Row/spins/radio_browser link kept for one-click reintroduce. Distinct from health-driven `active`.

**Why:** persistent connections are a scarce bandwidth budget; deleting stations breaks FKs, so hide must be soft.

**How to apply:**
- Any NEW listener-facing station query must add `hidden = false` (and usually `active = true`). There is no central visibility predicate, so leaks are easy: gate list endpoints, station-by-slug lookups (hidden → 404), and client-write paths alike.
- Flag flips live-apply via poller re-enrollment (unenroll first, no-op when hidden, watcher iff favorite ICY) — no restart needed.
- Admin flags endpoints are plain JSON, deliberately outside OpenAPI/orval (regen risk); admin UI uses plain fetch + x-admin-token.
- Admin router rate limit (10 req/15min) will 429 curl test bursts — flip flags directly in the DB when testing.
- LORE_ADMIN_TOKEN must live in Replit Secrets only; setting it as a dev env var writes the value into repo-tracked `.replit` (flagged as a credential leak).
