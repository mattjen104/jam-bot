# Past-Mode Tier Wiring — Manual Smoke Run

**Status: GATE WAIVED — tier wiring is enabled for general listeners by operator
risk-acceptance (2026-08-06). The four-tier manual runs have NOT been completed.
Schedule and run them when feasible; file any production findings as tasks.**

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
| Date / operator | _NOT RUN — see gate waiver above_ |
| Run (station, moment, track count) | |
| Wall time queue-run request → first audio | |
| Wall time full run | |
| Failure modes observed | |
| Rate limits observed (429s, Retry-After) | |
| Verdict (pass / fail / file task #) | |

### Tier 2 — YouTube embed auto-advance

Verify specifically:
- IFrame ENDED event advances to the next track without interaction.
- Unresolvable track mid-run: the dial **stops and says so** (no silent downgrade).
- Note per-track embed load latency; YouTube throttling shows up as slow/failed loads
  rather than HTTP 429.

| Field | Recorded value |
|---|---|
| Date / operator | _NOT RUN — see gate waiver above_ |
| Run (station, moment, track count) | |
| Wall time per track load; full run | |
| Auto-advance fired on every track end? | |
| Failure modes observed | |
| Rate limits / throttling observed | |
| Verdict (pass / fail / file task #) | |

### Tier 3 — Bandcamp embed, manual advance

Verify specifically:
- Each track plays in the embed; **no** auto-advance ever fires (service contract).
- Manual advance moves to the next track's embed.
- Bandcamp embed URL resolution comes only from MB relationship URLs (no scraping).

| Field | Recorded value |
|---|---|
| Date / operator | _NOT RUN — see gate waiver above_ |
| Run (station, moment, track count) | |
| Wall time per embed load | |
| Any spontaneous auto-advance? (must be NO) | |
| Failure modes observed | |
| Rate limits observed | |
| Verdict (pass / fail / file task #) | |

### Tier 4 — Timed cue sheet

Verify specifically:
- Tracks **with** `spinDurationSeconds`: the "Next: {artist} — {title}" control surfaces
  at the right moment (compare against your stopwatch).
- Tracks **without** duration (42.3% of all-time spins): the Next control appears
  immediately and persistently.
- Copy reads as a cue sheet — never an apology or a promise of future support.

| Field | Recorded value |
|---|---|
| Date / operator | _NOT RUN — see gate waiver above_ |
| Run (station, moment, track count) | |
| Timed Next control accuracy (± seconds) | |
| Null-duration behavior correct? | |
| Failure modes observed | |
| Verdict (pass / fail / file task #) | |

### Materialization jobs (`replay_resolution_jobs` / `replay_materialization_jobs`)

After the runs, confirm rows actually landed:

```sql
SELECT count(*), max(created_at) FROM replay_resolution_jobs;
SELECT count(*), max(created_at) FROM replay_materialization_jobs;
```

| Field | Recorded value |
|---|---|
| Resolution jobs created / completed / failed | _NOT RUN_ |
| Materialization jobs created / completed / failed | |
| Any stuck/retrying jobs | |

## Sign-off

**⚠️ GATE WAIVER** — The four-tier manual smoke runs were NOT completed before enabling.
The authorising operator accepted the production risk on 2026-08-06 and directed that
tier wiring be opened for general listeners immediately. The waiver does not replace the
runs; complete them at the next opportunity and file any findings as tasks.

- [ ] All four tiers run end-to-end by a human operator _(waived — not yet run)_
- [ ] Findings recorded above _(waived — not yet run)_
- [ ] Code-change findings filed as separate tasks _(waived — file any production findings as tasks)_
- [x] Tier wiring enabled for general listeners _(enabled under waiver 2026-08-06)_

Waiver authorised by: operator  Date: 2026-08-06
