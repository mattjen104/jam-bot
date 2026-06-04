---
name: track-knowledge (liner-notes) pipeline
description: How jam-bot enriches a confirmed turntable track with real credits/pressing, and the two invariants that guard it.
---

# Track-knowledge / liner-notes enrichment

When the turntable confirms a track, jam-bot can post a follow-up "liner notes"
card with real production credits (MusicBrainz) + pressing detail (Discogs).
Lives in `src/turntable/{knowledge,musicbrainz,discogs}.ts`, wired into the
Slack `trackConfirmed` listener via a fire-and-forget IIFE.

## Invariants (these reflect the user's stated principles — keep them)
- **Never on the playback hot path.** Resolve/play/seek happen in
  `session.ts`; enrichment is only ever launched detached AFTER the now-playing
  card. It must never block or throw into the turntable flow — every source
  fetch + cache op is wrapped to degrade to `null`.
- **Never fabricate.** The optional LLM one-liner
  (`TRACK_KNOWLEDGE_LLM_SUMMARY`, off by default) is gated by the pure
  `summaryIsGrounded()` guard: any capitalized, non-sentence-initial token not
  present in the supplied facts → reject the whole summary. Prompt wording is
  NOT the backstop; the guard is. Prefer dropping the line over posting an
  unverified name.
- **Query-on-demand + cache, never warehouse.** Results (including empty ones,
  so duds aren't re-queried) are cached in the `track_knowledge` table with a
  TTL. All sources are independently optional/config-gated.
- **Canonical key = MusicBrainz recording id.** `enrichTrack` converges on it:
  check cheap preKey (`isrc:`/`tt:`) → `resolveRecordingId(isrc)` (1 request) →
  check `mbrec:<id>` and alias-write back to preKey on hit → else full fetch and
  write BOTH keys. So alternate ISRCs of one recording share a cache entry and
  the heavy credits/Discogs fetch runs once.

**Why:** user mjensen (non-technical/director) was explicit — accuracy over
coverage, no fabricated facts, don't build a music warehouse, and the recording
id is the spine for downstream knowledge features.

**How to apply:** any new knowledge source plugs in behind the same
optional-gate + cache + off-hot-path pattern; any new generated text about a
track must pass a grounding check before it reaches a user.
