---
name: Dial filter menus semantics
description: Age-tier and station-category filter rules for the Dial's two-sided filter bar
---

# Dial filter menus (First|Current|Catalog|Deep · seven editorial categories)

Rules future changes must stay consistent with:

- **Age tiers are client-derived from `releaseYear`** (now on NowPlaying/recent-spin/SSE payloads): First = `isFirstSpin` (takes precedence), Current ≤ 18 months, Catalog 19–60, Deep > 60 — approximated in whole years since only the release year is known.
- **Unknown release year always passes** the age filter (null tier never hides a row). Rows with no current track also pass. Hiding unknowns would empty the dial because MB resolution is best-effort.
- **Age tiers are additive multi-select** (empty set = no filtering). **Station categories are radio-style single-select**: seven mutually exclusive editorial labels (ambient/campus/specialist/anchor/public/indie/discovery). Initial state is EMPTY = unfiltered; once a category is picked, selecting a new one replaces it and re-selecting the active one is a no-op (same Set reference) — a selection can never return to empty.
- **Never default to a specific category** — a non-empty default filters the front door down to that category and breaks every front-door e2e spec (crossings, onboarding, mobile rows). Empty-set-by-default is the intended "show everything" state.
- **Server emits exactly one category per station** (`deriveStationCategories`, precedence ambient > campus > specialist > anchor > public > indie > discovery; tag-driven with slug allowlists as backstop; discovery is the unconditional fallback). `ambient` routes to `mode=sleep`, `specialist` to `mode=era-genre`, all others filter the default list client-side on `stationCategories`.
- **Filter bar is visible on the full DialView (/lore/feed)**; ghost/missed rows are never filtered.
- **Why:** filters are ephemeral browse state, not persisted, and reuse existing station-list endpoints instead of a new API.

Gotcha: category buttons must carry `aria-pressed` (toggles), never act as plain navigation (see dialTimeTravelStrip test). The old additive Lore/Classics/Ambient trio and /genre /spinitron /college /flagship commands are retired.
