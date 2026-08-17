---
name: Dial filter menus semantics
description: Age-tier and station-category filter rules for the Dial's two-sided filter bar
---

# Dial filter menus (First|Current|Catalog|Deep · seven editorial categories)

Rules future changes must stay consistent with:

- **Age tiers are client-derived from `releaseYear`** (now on NowPlaying/recent-spin/SSE payloads): First = `isFirstSpin` (takes precedence), Current ≤ 18 months, Catalog 19–60, Deep > 60 — approximated in whole years since only the release year is known.
- **Unknown release year always passes** the age filter (null OR undefined tier never hides a row — `rowPassesAgeTierFilter` uses `== null` so payloads without the field pass too). Rows with no current track also pass. Hiding unknowns would empty the dial because MB resolution is best-effort.
- **Both families are additive multi-select** (checked entries union; empty set = no filtering). Categories were once single-select — that era is over.
- **Defaults are NON-EMPTY by explicit user choice (Aug 2026):** all four age tiers checked, and anchor+campus+public categories checked (Ambient & Sleep, Specialist, Indie, Discovery are opt-in). Shared constants `DEFAULT_ACTIVE_AGE_TIERS` / `DEFAULT_ACTIVE_STATION_CATEGORIES` live in dialFilterState.ts; SplitHome and DialView initialize copies of them.
- **Why:** the user wants the checkboxes to visibly show the active browse scope on load instead of an unchecked "everything" state.
- **How to apply:** CLI commands (/deep, /campus, …) TOGGLE membership, so a command for a default entry now UNCHECKS it. Tests and e2e fixtures must start from the default-checked state — front-door e2e station fixtures need at least one default category (anchor/campus/public) on every station meant to be visible on load, and the Station type trigger badge starts at "· 3".
- **Server emits exactly one category per station** (`deriveStationCategories`, precedence ambient > campus > specialist > anchor > public > indie > discovery; tag-driven with slug allowlists as backstop; discovery is the unconditional fallback). `ambient` routes to `mode=sleep`, `specialist` to `mode=era-genre`, all others filter the default list client-side on `stationCategories`.
- **Filter bar is visible on the full DialView (/lore/feed)**; ghost/missed rows are never filtered.
- Filters are ephemeral browse state, not persisted, and reuse existing station-list endpoints instead of a new API.

Gotcha: category buttons must carry `aria-pressed` (toggles), never act as plain navigation (see dialTimeTravelStrip test). The old additive Lore/Classics/Ambient trio and /genre /spinitron /college /flagship commands are retired.

Gotcha (dropdown era): the dropdown panels are `position:fixed` anchored to the trigger's left edge — any anchored fixed panel MUST clamp against `window.innerWidth` after render (layout effect) or triggers near the right edge open off-screen on mobile and look like dead buttons.
