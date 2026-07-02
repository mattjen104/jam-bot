---
name: Lore pickers/picks generalization
description: Durable decisions behind generalizing Lore's DJ/spin model to any taste source.
---

# Pickers / picks generalization — durable decisions

Lore's DJ/spin model is one instance of "a trusted human picked this". The
generalization adds `pickers` (dj|label|blog|curator|collector|event) + `picks`
(one selection resolved best-effort to the MBID spine) and a `picks_unified`
read VIEW that UNIONs picks with spins projected as dj pickers.

## Decisions to stay consistent with

- **Always log a pick, even unresolved (mbid null).** Mirrors spins; keeps the
  honesty gradient visible and lets backfill converge later.
  **Why:** a track radio never touches must still be enterable via its label/blog.

- **The entry ladder stops at artist-level; there is NO scene/neighbour rung.**
  Rungs: dj → label → blog/curator → collector/event → artist → empty.
  **Why:** reaching an artist no picker ever touched requires acoustic/CF
  similarity — the algorithmic recommender Lore refuses to be. Land on empty with
  a "be the first" (`user_seed`) invitation instead of faking a human pick.
  **How to apply:** never add a rung that infers picks from similarity; only add
  rungs backed by a real human selection edge.

- **Ordered picks are rideable as sequences (generalized segue); unordered ones
  are a set.** `ordinal` non-null = sequenced (label release, ranked list, event
  lineup); adjacent same-picker picks form an edge, an unresolved pick breaks the
  chain exactly like an unresolved spin (never bridge a hole). Unordered picks
  (ordinal null) are ridden as a set, never a sequence.
  **How to apply:** pick-segues are computed on read (lists are small) via the
  same pure deriver, and merged with spin-segues onto one "what plays next"
  surface. Don't persist pick edges into `segue_edges` (it requires a station).

- **The `picks_unified` view is `.existing()` + raw `CREATE OR REPLACE` at boot.**
  **Why:** on a push-based drizzle-kit project, letting drizzle-kit manage a view
  risks permanent push drift (same class as the NULLS-NOT-DISTINCT issue).

- **New source = a new worker producing PickInputs; never source-specific logic
  in the resolver/ladder.** Labels via MusicBrainz release-by-label (recording_id
  confidence). Blogs: dependency-free RSS parse, store only resolved pick + post
  link, NEVER body text, skip on no confident match. Discogs API-only. RYM
  link-out only (register picker, ingest nothing).

- **Seed pickers register the source by real URL but never hardcode MBIDs.**
  **Why:** a wrong MBID poisons the spine. Label catalogue ingest is
  admin-triggered with a verified MBID; blog feeds are polled best-effort (a
  dead/moved feed just logs and is skipped).
