---
name: Lore e2e suite gate
description: which lore browser specs gate merges, fixture pitfalls, and what was deleted
---
`lore-e2e-suite` validation runs `artifacts/lore/e2e/run-e2e-suite-gate.sh` (fails loudly if Chromium is missing; uses the running lore dev server when reachable, otherwise self-starts a dedicated vite on a free ephemeral port). It runs the fully route-intercepted specs: importPickerEntryPoints, spotifyConnectCallback, librarySyncLifecycle (dial-style SyncBar lifecycle), ntsOnAirBadge (dial front-door on-air show + DJ attribution), and fallbackNotice (archive-run fallback notice). interstitialTone stays in its own `tone-e2e` gate.

Deleted (UI intentionally removed; do not resurrect without the UI):
- libraryPromptVisibility + spotifyConnectButton — `library-prompt` banner removed; connect surface covered by importPickerEntryPoints.
- linerNotesSheet — RecordPeekNav and the NowPlaying panel (incl. LinerNotesSheet) are both unmounted; section nav is SlimSectionNav.

Fixture pitfalls learned while reviving specs (**How to apply** when writing new lore Playwright specs):
- Generated clients zod-parse responses: Station fixtures need ALL required fields (incl. `clickcount`, `upcomingShowCount`); NowPlaying needs `isLibraryHit`/`isArtistHit`. A missing field silently kills the query → dial renders nothing.
- POSTs often carry query strings (`/api/me/library/sync?service=spotify`); register BOTH `**/path` and `**/path?**` globs or the stub is bypassed.
- Dial "DJs on air" band needs: live pulse in `GET /api/stations/now-playing` (fresh playedAt) + a today-schedule run bracketing now with `show.djName`. The row renders as one sentence button ("Ben UFO selected … on Hessle Audio nts-1") — station display NAME may not appear; assert on the button's accessible name, not the station name.
- Anonymous dial (no library/seeds) shows the "Pick the artists you love" onboarding placeholder — a reliable load anchor for negative tests.
- Register a broad `**/api/**` catch-all FIRST (most-recent handler wins), but several components crash on `{}`: /api/player/onair needs `{items:[]}`, /api/replay/*/playlist-targets needs `{targets:[]}`, /api/recordings/:mbid/entry needs `{rung:"empty",picks:[]}`, and run insights need `{genreBreakdown:null,discoveryScore:null}` (an empty array crashes on `.top`).
- `/archive/picker-runs/:id` is a legacy Redirect that DROPS the query string — deep links with ?play=1&from= must use `/archive/selector-runs/:id`.

- Library first-run auto-open: an empty library (+ no seeds, no avatar) auto-opens the import modal once per session — empty-state specs must pre-set `sessionStorage lore:first-run-prompted=1` via addInitScript or clicks get intercepted.
- The ImportStrip "Add more +" entry point is gone (done jobs render no strip); its spec was removed — don't resurrect it.
- A dead/stale lore dev workflow makes localhost:80/lore/ return 502 → every spec's `.fdrow` wait times out looking like a rendering regression. mobileFrontDoor's loadFrontDoor now asserts response.ok() + `.split-home` mount first, so server-down vs row-filter failures are distinguishable. Restart the `artifacts/lore: web` workflow before believing a direct (non-gate) spec run.
- Under concurrent-merge load the full gate flakes on DIFFERENT route-intercepted specs per run (compactStackBand reload `net::ERR_ABORTED`, cornerNavTappability landscape) — each passes in isolation. Before blaming your diff, run the failing spec alone on your tree (`PLAYWRIGHT_WEB_SERVER_PORT=<free> pnpm exec playwright test <spec> -g <title>`); a pass means contention flake, not regression.
