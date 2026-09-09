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
- Deck is a side-by-side strip (before · kept · after, broadcast order) — never stack covers behind each other; collapsed peeks read as "only one cover." Portrait ≤640px: full-width edge-to-edge squares via aspect-ratio, caption line names the selected cover (tap/hover/focus selects), text below.
- The deck is a PEEK interaction (since 2026-09): one visible cover + chevrons + horizontal swipe (40px threshold, vertical-dominant gestures ignored); peeked song is named in the host's copy column via onSelectionChange, not inside the deck.
- Cover sizing must be WIDTH-driven (width: var(--deck-cover); height via flex stretch). Deriving width from aspect-ratio + stretched height in an `auto` grid column is circular: once images load, the column eats the row and the copy collapses to 0px wide / 600px tall.
- The crate's own mobile media block (~line 3911 in index.css) re-pins `.library-crate__track` to "72px 1fr"; any `--deck` card-level override must live in a LATER media block or it silently loses the cascade (this bug made decks render 72px wide on phones).
- Real listener libraries are ~1.9k keeps, ALL spinless (spin_id NULL) — the artist-fallback path is the hot path, not the exception; it needs the `recordings_artist_lower_trim_idx` functional index (boot migration) or each chunk seq-scans ~300k recordings.
- set-contexts has a 30-min per-(user, anchor) in-memory cache; `scripts/warm-library-decks.ts` pre-warms all devices ≥50 keeps (run after restarts for instant crates). Cache drops on restart by design.
- Verify layout changes with the deck-portrait-verify tester flow: seed script `artifacts/api-server/scripts/seed-deck-demo.ts` (device lore_sid=deck-demo, hidden station), then a 402x874 portrait run against /lore/library.
- Preview audio must stop on host unmount (LibraryCrate cleanup) and never overlap live radio.
