---
name: Dial filter menus semantics
description: Age-tier and station-category filter rules for the Dial's two-sided filter bar
---

# Dial filter menus (First|Current|Catalog|Deep · Lore|Classics|Ambient)

Rules future changes must stay consistent with:

- **Age tiers are client-derived from `releaseYear`** (now on NowPlaying/recent-spin/SSE payloads): First = `isFirstSpin` (takes precedence), Current ≤ 18 months, Catalog 19–60, Deep > 60 — approximated in whole years since only the release year is known.
- **Unknown release year always passes** the age filter (null tier never hides a row). Rows with no current track also pass. Hiding unknowns would empty the dial because MB resolution is best-effort.
- **Both menus are additive multi-selects.** Age tiers allow the empty set (= no filtering). Station categories have last-category protection: deselecting the only active category is a no-op returning the same Set reference.
- **Categories map to station mode flags**: Lore = normal, Classics = `eraGenreMode`, Ambient = `sleepMode`. Category fetching merges per-mode station lists in `useDialData`, deduped by slug.
- **Filter bar renders only in live mode** and hides while the gesture-based hidden browse mode owns the list; ghost/missed rows are never filtered.
- **Why:** filters are ephemeral browse state, not persisted, and reuse existing station-list endpoints instead of a new API.

Gotcha: the filter bar's "Lore" toggle collides with old "no nav buttons" assertions — a `Lore` button is allowed iff it has `aria-pressed` (toggle), never as plain navigation (see dialTimeTravelStrip test).
