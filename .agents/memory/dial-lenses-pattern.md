---
name: Dial lenses (Radio / Press)
description: How the Dial's exclusive lens views work — state ownership, Press read-model, shared cache busting.
---

# Dial lenses (Radio / Press)

The Dial has exclusive lens views over one feed surface: Radio (live-station
crossings, the default) and Press (taste × scraped-metadata mentions: picks,
list entries, published track claims). A third "Shows" lens is planned.

**Rules:**
- Lens state is local-first (`lore:dialLens` in localStorage, parse defaults to
  radio on any unknown value — future lens values must stay safe on old
  clients). Owned by DialView next to filter state; never server-persisted.
- Radio filter menus (song age, station categories) are Radio-only: they render
  inside the radio branch, so new lenses never inherit them.
- The Press lens bar reuses the filter-bar button anatomy (`dial-filter-bar__btn`,
  aria-pressed) — same keyboard affordance, but lens buttons are exclusive.
- Press read-model (`/api/me/press-crossings`) computes inline (no background
  compute — the three mention queries are cheap, bounded, LIMIT'd), caches
  per-user in-process (15 min, 2 min for empty), and is busted by the SAME
  `bustCrossingsCache()` call as Radio, so any Stack/taste change refreshes
  both lenses. `hasTaste` comes from the server (same three taste sources as
  the crossings fast-path) so both lenses agree on the seeding nudge.
- DJ-spin picks (`pickerType='dj'` / `source='spin'`) are excluded from Press —
  they ARE the Radio lens.
- List entries participate only when `confidence='exact'` OR `confirmed=true`
  (same rule as provenance queries); track claims only when `status='published'`.

**Why:** lenses are exclusive views, not interleaved feeds; sharing the cache
bust and taste definition keeps the two lenses from drifting apart on what
"your taste" means.

**How to apply:** a new lens (e.g. Shows) = new parse value in dialLensState +
new branch in DialView's live-mode section + its own read-model that reuses
`hasTaste` + the shared bust hook. Never put lens-specific filters outside its
branch.
