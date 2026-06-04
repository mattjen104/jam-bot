---
name: jam-bot knowledge/insights clock model
description: How the knowledge + timed-insights layer is driven during a normal Spotify Jam (not just turntable), and the clock-anchor discipline that keeps notes firing at the right moment.
---

# Knowledge + insights during a normal Spotify Jam

The liner-notes/credits card, genre/era/story context card, and live timestamped
insights fire in BOTH turntable/record mode AND a normal Spotify Jam.

## Source-of-truth rule (non-obvious, honor it)
- For a NORMAL Jam, **Spotify is the source of truth**: enrichment keys off the
  track's own **ISRC** and the live playhead is read from Spotify's reported
  `progress_ms` via the now-playing poll. **No mic, no muting, no
  fingerprinting** in this path.
- Fingerprinting (ACRCloud) exists ONLY in turntable mode and is worse for
  position (imprecise, costs ACR calls, can miss). Do not reach for it to get
  position in the normal-Jam path.
- Computer-audio capture is a SEPARATE concern, not this path.

## Clock-anchor discipline (the part that bites)
The single `InsightScheduler` reads position from a pluggable provider: the
turntable needle clock when a record session is active, else
`computeTargetPositionMs(nowPlayingAnchor, now)` for the normal Jam. The anchor
is a local interpolation of Spotify's last reported position. Rules that must
hold or notes fire at the wrong time:
- **Re-anchor synchronously on track change** (off the trackChange event's own
  progress/duration) BEFORE arming — otherwise freshly-armed insights are
  evaluated against the PREVIOUS track's still-advancing anchor and dump a burst
  at once.
- **Clear the anchor on pause** (`position` event carries `isPlaying`; anchor =
  null when not playing) so the scheduler stands down instead of interpolating
  forward over a frozen track.
- **`arm([])` disarms** the scheduler (clears pending+fired). So a track with no
  ISRC must arm with `[]`, never be skipped — skipping leaves the prior track's
  notes armed and they leak onto the new track.

## Mutual exclusion
Turntable owns the now-playing surface when active: the ambient trackChange
handler early-returns on `turntableSession.isActive()`, so the two paths never
double-post or double-arm. Turntable stop calls `insightScheduler.disarm()`.

**Why:** these were the exact correctness bugs found in review when the layer was
generalized from turntable-only to Jam-wide.

## Known residual (non-severe)
Queue-dry with an active device but no current track emits no `position` event,
so the anchor can persist briefly; bounded because `computeTargetPositionMs`
clamps to duration and the next trackChange re-arms/disarms. Safe to harden by
clearing the anchor when `cp.track` is absent (not just on `noActiveDevice`).
