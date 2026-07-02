---
name: Lore now-playing resolution contract
description: Behavioral contract for Lore station now-playing — what degrades and why UI/tests must not assume presence.
---

Lore resolves each station spin to the MBID spine best-effort, in confidence tiers:
`recording_id` (station gave an MBID) > `isrc` > `text` (artist+title MB search) > `unresolved`.
A spin is **always logged** even when unresolved (mbid null, raw metadata preserved).

**Artwork and deep links are best-effort and frequently absent:**
- Artwork is often null for `text`/`isrc` matches — the UI must degrade to a placeholder disc, and tests must NOT assert an artwork element is always present.
- Deep links degrade to `kind: "search"` (artist+title search URLs) unless Spotify + Odesli
  credentials are configured, in which case some become `kind: "exact"`. With creds unset,
  expect only search links.

**Why:** e2e tests that assert artwork/exact-links always render will flake, because which
track is on air (and whether it carries artwork/exact links) changes every poll and depends on
unconfigured external creds. Assert title/artist/deep-links-present + attribution instead.

**How to apply:** When building or testing Lore Phase 2+ UI, treat `recording`, `artworkUrl`,
and exact links as optional. The spine guarantee is the MBID when confidence != `unresolved`, not artwork.
