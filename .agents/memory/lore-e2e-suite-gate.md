---
name: Lore e2e suite gate
description: which lore browser specs gate merges, fixture pitfalls, and what was deleted
---
`lore-e2e-suite` validation runs `artifacts/lore/e2e/run-e2e-suite-gate.sh` (fails loudly if Chromium or the lore dev server is missing, same pattern as the tone gate). It runs the fully route-intercepted specs: importPickerEntryPoints, spotifyConnectCallback, librarySyncLifecycle (dial-style SyncBar lifecycle), and ntsOnAirBadge (dial front-door on-air show + DJ attribution). interstitialTone stays in its own `tone-e2e` gate.

Still excluded (carries `// GATE-EXCLUDED:` header):
- fallbackNotice — discovers run IDs from LIVE spin data via pinned MBID/picker anchors that drifted out of the dev DB; live-data flaky. Stabilizing means route-intercepting the discovery endpoints.

Deleted (UI intentionally removed; do not resurrect without the UI):
- libraryPromptVisibility + spotifyConnectButton — `library-prompt` banner removed; connect surface covered by importPickerEntryPoints.
- linerNotesSheet — RecordPeekNav and the NowPlaying panel (incl. LinerNotesSheet) are both unmounted; section nav is SlimSectionNav.

Fixture pitfalls learned while reviving specs (**How to apply** when writing new lore Playwright specs):
- Generated clients zod-parse responses: Station fixtures need ALL required fields (incl. `clickcount`, `upcomingShowCount`); NowPlaying needs `isLibraryHit`/`isArtistHit`. A missing field silently kills the query → dial renders nothing.
- POSTs often carry query strings (`/api/me/library/sync?service=spotify`); register BOTH `**/path` and `**/path?**` globs or the stub is bypassed.
- Dial "DJs on air" band needs: live pulse in `GET /api/stations/now-playing` (fresh playedAt) + a today-schedule run bracketing now with `show.djName`. The row renders as one sentence button ("Ben UFO selected … on Hessle Audio nts-1") — station display NAME may not appear; assert on the button's accessible name, not the station name.
- Anonymous dial (no library/seeds) shows the "Pick the artists you love" onboarding placeholder — a reliable load anchor for negative tests.
