---
name: Library set-context deck
description: Crate rows show the kept track plus its before/after set neighbors as preview-playable covers; rules for ownership, boundaries, and fallback honesty.
---

Library crate rows render a 3-cover deck (before / anchor / after) from `POST /api/me/library/set-contexts` (plain-JSON, NOT orval — follows the track-expiry fast-lane convention). Spin-backed keeps anchor on the retained `library_items.spin_id`; artist-file saves and spinless keeps anchor on the artist's most recent resolved spin across visible (non-hidden) stations.

**Why:** The deck answers "what was playing around this keep" without leaving the Library, and each cover is an inline iTunes preview play button (shared page audio singleton, yields live radio via `radio.stop()`).

**How to apply:**
- Artist anchors MUST be scoped to the requesting user's taste universe (taste_seeds + active library artists + unresolved import artists); unowned artists return explicit null. Code review caught the unscoped version.
- Neighbors are station-scoped and bounded to ±20 minutes of the anchor spin; anything farther is a set/ad boundary and must be omitted, not implied.
- Fallback contexts carry `anchorKind: "artist-fallback"` and the UI labels them "latest set" — never present a substituted song as the kept broadcast.
- Deck fan-out scales the three covers into the same footprint (no overflow, no z-index fights, works on touch via focus-within).
- Preview audio must stop on host unmount (LibraryCrate cleanup) and never overlap live radio.
