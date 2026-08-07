# Past-Mode Tier Wiring — Manual Smoke Run

**Status: GATE WAIVED — tier wiring is enabled for general listeners by operator
risk-acceptance (2026-08-06). A programmatic review was completed 2026-08-07
covering API negative paths, code static analysis, and DB state. The audio/device
paths (gapless playback, IFrame ENDED events, embed load latency) still require a
human operator with a real Spotify Premium account and audio device to complete.**

This is the hard precondition from the tier-orchestration spec: both
`replay_resolution_jobs` and `replay_materialization_jobs` are empty in production, so
the materialization path has never executed against real traffic. A human operator must
run one end-to-end replay per tier and record wall time, failure modes, and rate limits
here. Any finding that needs a code change gets filed as its own task before wiring goes
live.

## Prerequisites

- Spotify **Premium** account, connected via the app's Spotify connect flow
  (`GET /api/spotify/login` → OAuth → `?spotify=connected`), with an **active Connect
  device** (open the Spotify app on desktop/phone and press play once so the device
  registers).
- A real past crossing moment on the Dial (pick one with ≥5 spins, ideally including at
  least one track with `spinDurationSeconds = null` to exercise the persistent-Next path).
- Clear `lore:last-used-service` in localStorage before starting so tier ranking (not the
  preference override) is what you're testing first.

## How each tier is triggered

The Dial picks the tier via `selectPastModeTier()` and announces it before playback
(`tierAnnouncementText`). Force each tier as follows:

| Tier | Expected announcement | How to force it |
|---|---|---|
| 1 Spotify Connect | "This will play hands-free on Spotify" | Spotify connected + Premium + active device; no last-used preference |
| 2 YouTube | "YouTube will auto-advance through the run" | Disconnect Spotify (or set last-used-service to `youtube` in localStorage) |
| 3 Bandcamp | "Each track opens in Bandcamp — you'll advance manually" | Set `lore:last-used-service` to `bandcamp`; pick a run whose tracks have Bandcamp links |
| 4 Cue sheet | "Follow the cue sheet to advance each track" | Set `lore:last-used-service` to a link-only service (e.g. `tidal`) |

## Per-tier run sheets

For each tier: start a stopwatch at the moment you confirm playback, note every
failure/oddity with a timestamp, and watch the network tab for 429s / `Retry-After`.

### Tier 1 — Spotify Connect (single `uris`-array queue call)

Verify specifically:
- Exactly **one** `POST /api/spotify/queue-run` request for the whole run (never
  per-track calls).
- Response is `{ queued: N }` where N = number of tracks from the landed track onward.
- Playback is gapless and hands-free on the Connect device.
- Negative paths worth one attempt each: no active device → HTTP 409; free account →
  403; hammering the endpoint → 429 with `retryAfter` in the body.

| Field | Recorded value |
|---|---|
| Date / operator | 2026-08-07 / Replit Agent (programmatic review) |
| Run (station, moment, track count) | _Not run — audio device required_ |
| Wall time queue-run request → first audio | _Not run — audio device required_ |
| Wall time full run | _Not run — audio device required_ |
| Failure modes observed | **API negative paths verified live:** empty body → 400 `{"error":"uris (non-empty array of Spotify track URIs) is required"}`; empty `uris:[]` → 400 (same); no session cookie → 401 `{"error":"Spotify is not connected for this session"}`. Code-confirmed paths: free account → 403; no active device → 409; rate-limited → 429 with `retryAfter` field. Single-call queue design (`playTracks(conn.accessToken, parsed.data.uris, ...)`) confirmed — never per-track. Response shape `{queued: N}` confirmed in route handler. |
| Rate limits observed (429s, Retry-After) | Not exercised (no Premium session available). Code confirms 429 body includes `retryAfter: err.retryAfterSecs ?? 30`. |
| Verdict | **PARTIAL PASS** — all reachable paths verified. Gapless audio and device continuity require human operator with Premium + active device. |

### Tier 2 — YouTube embed auto-advance

Verify specifically:
- IFrame ENDED event advances to the next track without interaction.
- Unresolvable track mid-run: the dial **stops and says so** (no silent downgrade).
- Note per-track embed load latency; YouTube throttling shows up as slow/failed loads
  rather than HTTP 429.

| Field | Recorded value |
|---|---|
| Date / operator | 2026-08-07 / Replit Agent (programmatic review) |
| Run (station, moment, track count) | _Not run — browser + audio required_ |
| Wall time per track load; full run | _Not run — browser + audio required_ |
| Auto-advance fired on every track end? | **Code confirmed:** `useYouTubeDriver` subscribes to `onStateChange` via postMessage; `state === 0` (ENDED) triggers PlayerProvider advance. `GUIDED_SERVICE_OPTIONS` entry: `embedAutoAdvance: true` → `serviceOptionTier` returns 2. IFrame embed URL uses `enablejsapi=1` parameter. Live browser test still needed to confirm the postMessage channel fires correctly across the proxy iframe boundary. |
| Failure modes observed | _Not run_ |
| Rate limits / throttling observed | _Not run_ |
| Verdict | **PENDING** — auto-advance logic verified in code; live IFrame ENDED event needs human confirmation (see task #1144). |

### Tier 3 — Bandcamp embed, manual advance

Verify specifically:
- Each track plays in the embed; **no** auto-advance ever fires (service contract).
- Manual advance moves to the next track's embed.
- Bandcamp embed URL resolution comes only from MB relationship URLs (no scraping).

| Field | Recorded value |
|---|---|
| Date / operator | 2026-08-07 / Replit Agent (programmatic review) |
| Run (station, moment, track count) | _Not run — browser + audio required_ |
| Wall time per embed load | _Not run — browser + audio required_ |
| Any spontaneous auto-advance? (must be NO) | **Code confirmed NO:** Bandcamp entry in `GUIDED_SERVICE_OPTIONS` has `embedUrlBuilder: bandcampEmbedUrl` and no `embedAutoAdvance` flag → `serviceOptionTier` returns 3. PlayerProvider Tier-3 path has no auto-advance timer or ENDED handler. `bandcampEmbedUrl()` accepts only `/EmbeddedPlayer/` URLs (MB relationship URLs are the only input) — public track page URLs return `null` and fall to `externalOnly`. |
| Failure modes observed | _Not run_ |
| Rate limits observed | _Not run_ |
| Verdict | **PENDING** — no-auto-advance contract verified in code; live embed load and manual advance need human confirmation. |

### Tier 4 — Timed cue sheet

Verify specifically:
- Tracks **with** `spinDurationSeconds`: the "Next: {artist} — {title}" control surfaces
  at the right moment (compare against your stopwatch).
- Tracks **without** duration (42.3% of all-time spins): the Next control appears
  immediately and persistently.
- Copy reads as a cue sheet — never an apology or a promise of future support.

| Field | Recorded value |
|---|---|
| Date / operator | 2026-08-07 / Replit Agent (programmatic review) |
| Run (station, moment, track count) | _Not run — browser required_ |
| Timed Next control accuracy (± seconds) | _Not run — browser + stopwatch required._ Code path: `window.setTimeout(() => setCueSheetVisible(true), spinDur * 1000)` in `PlayerProvider.tsx:2812` — accuracy bounded by JS timer resolution (~10 ms), not a structural concern. |
| Null-duration behavior correct? | **Code confirmed YES:** `if (spinDur == null) { setCueSheetVisible(true); return; }` (PlayerProvider.tsx:2807-2809) — fires immediately and persistently, no timeout set. Comment notes "42.3% of spins". `cueSheetNext` shows `queue[index+1].artist — queue[index+1].title`. RideBar renders "Next" label in mono uppercase + artist/title in font-serif. Copy is descriptive, not an apology ("Follow the cue sheet to advance each track"). |
| Failure modes observed | _Not run_ |
| Verdict | **PARTIAL PASS** — null-duration immediate-display logic verified in code; timer accuracy against a real stopwatch needs human confirmation. |

### Materialization jobs (`replay_resolution_jobs` / `replay_materialization_jobs`)

After the runs, confirm rows actually landed:

```sql
SELECT count(*), max(created_at) FROM replay_resolution_jobs;
SELECT count(*), max(created_at) FROM replay_materialization_jobs;
```

| Field | Recorded value |
|---|---|
| Resolution jobs created / completed / failed | **0 rows** as of 2026-08-07. No jobs have been created since tier wiring was enabled (2026-08-06). Both tables are empty — the materialization path has not been exercised in production. |
| Materialization jobs created / completed / failed | **0 rows** as of 2026-08-07. |
| Any stuck/retrying jobs | None — tables are empty. |

## Sign-off

**⚠️ GATE WAIVER** — The four-tier manual smoke runs were NOT completed before enabling.
The authorising operator accepted the production risk on 2026-08-06 and directed that
tier wiring be opened for general listeners immediately. The waiver does not replace the
runs; complete them at the next opportunity and file any findings as tasks.

**2026-08-07 update:** A programmatic review was completed covering API negative paths
(live HTTP tests against the running server), code static analysis of all four tier
implementations, and DB table state. Audio/device and live browser paths remain pending;
see verdicts above for what was and was not verified.

- [ ] All four tiers run end-to-end by a human operator _(Tier 1: audio/device pending; Tier 2: IFrame ENDED in browser pending; Tier 3: live embed pending; Tier 4: stopwatch accuracy pending)_
- [x] Findings recorded above _(programmatic review 2026-08-07; audio paths still pending)_
- [x] Code-change findings filed as separate tasks _(Task #1144 — YouTube auto-advance positive-path confirmation)_
- [x] Tier wiring enabled for general listeners _(enabled under waiver 2026-08-06)_

Waiver authorised by: operator  Date: 2026-08-06
Programmatic review by: Replit Agent  Date: 2026-08-07
