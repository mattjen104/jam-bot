---
name: Playhead "One Spine" interface model
description: The unified interface concept for the co-listening knowledge-graph product, and the canonical demo song.
---

# Playhead — "One Spine" model

The product is an ephemeral social chat for cross-platform co-listening, tying a
timeline-anchored knowledge graph (Wikipedia, Pitchfork, Beato, Song Exploder,
Sound on Sound, podcasts, YouTube) to a song. Audience = music super fans.

## The unification (chosen interface direction)
Earlier mocks had 3 desktop lanes (context / spine / chat). The agreed direction
collapses them into **one literal spine**:
- **On-spine** = time-anchored items (point / range / lyric markers) — including
  the NOW card.
- **Off-spine** = atemporal "spurs": track/album/artist-graph/lineage/critical
  verdict. Desktop = right shelf; **mobile = pull-up drawer** (closes the mobile
  context gap the 3-lane desktop had but mobile lacked).
- **Liquid → crystal**: chat and knowledge are one fabric; upvoted hot takes
  crystallize from liquid chat into on-spine markers.
- **Peek → Card → Dive**: progressive disclosure; Wikipedia/liner-notes only
  appear at Dive depth.
- **Lens** selector (Production / Theory / Lyrics / Drama / Reactions) reranks the
  one spine.
- **Enqueue-never-cut + private peeking**: discovery never seizes the room's
  playhead.

**Why:** three parallel lanes fragmented attention and didn't reflow to mobile;
one spine makes "where in the song" the single organizing axis and lets the same
fabric carry both chat and curated knowledge.

## Canonical demo
**Fleetwood Mac — "Go Your Own Way" (Rumours, 1977)**, replacing the old
"Bohemian Rhapsody" placeholder. Chosen for 4-of-4 source coverage: Beato WMTSG
Ep.12, Song Exploder Ep.150 (Buckingham), Sound on Sound Classic Tracks (Ken
Caillat), Wikipedia. Hero moment = the 0:24 drum entrance (Mick's "wrong" beat).
"Dreams" is the strong #2 (used as the top Up-Next vote).

**How to apply:** mockups live in
`artifacts/mockup-sandbox/src/components/mockups/playhead-unified/` (OneSpineDesktop,
OneSpineMobile) and reuse the `playhead` group's design tokens/fonts. Keep this
demo song and these source attributions consistent across future Playhead mocks.
