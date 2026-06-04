---
name: jam-bot live track insights
description: Design decisions for the timestamped-insight feature (notes fired at the right playback moment).
---

# jam-bot live timestamped insights

Surfaces short curated musical notes at the right moment as a record plays under
turntable sync. Source of truth is a hand-curated seed (`insights-seed.ts`) —
no automated ingestion/LLM; notes are never fabricated. Empty seed => no-op.

## Durable decisions (respect these in future work)

- **Baseline firing is INCLUSIVE (`positionMs >= baseline`).**
  **Why:** the scheduler arms with `baseline = current clock position` on
  trackConfirmed. With strict `>`, a 0:00 note can never fire on a track started
  from the top (the Bohemian Rhapsody intro note was silently dropped — caught
  in architect review). Equality at the baseline means "right now", not "already
  passed". Notes *strictly before* the baseline are still skipped as backfill,
  so joining mid-track never replays earlier moments.
  **How to apply:** keep the `>=` in `selectDueInsights`; if you ever rework
  baseline semantics, preserve "fire at-or-after join point, never before".

- **Arm off `match.isrc`, NOT the MusicBrainz recording id.**
  **Why:** ISRC is on the ACR match immediately at trackConfirmed; recording id
  only resolves later inside the (independently-gated) knowledge layer. Arming
  on ISRC keeps insights working even when the knowledge feature is off and
  avoids a stale-track race (the track can change before recordingId resolves).
  `getInsightsFor` still merges/dedupes both id forms for future use.

- **Off the hot path by construction.** The `InsightScheduler` only *reads*
  `turntableSession.status().positionMs` on its own timer; it never seeks and
  never sits in resolve/play/seek. `status().positionMs` is `null` when
  inactive, which the scheduler treats as "disarm".

- **Anti-spam = per-play `fired` set + `minGapMs` throttle (one note per gap),**
  fires the earliest due note per tick. `lastFireAtMs` starts at `-Infinity` and
  resets on `arm()` so the first note of each track fires immediately when due,
  regardless of clock origin (a `nowMs=0` test collided with a `0` init once).

- Delivery reuses `deliverTurntableCard` (DM origin or Jam-gated channel) — same
  routing/gating as every other turntable card.
