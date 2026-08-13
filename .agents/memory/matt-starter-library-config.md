---
name: Matt's starter library configuration
description: How the operator-owned starter library is wired and why it silently reports unavailable
---

# Matt's starter library

The "Start with Matt's library" feature copies resolved `library_items` rows from an
operator-owned source account into the current listener's library.

**Rule:** the source account is configured ONLY via the `MATT_LIBRARY_SOURCE_USER_ID`
env var (shared environment). If unset or non-numeric, the feature fails closed:
`GET /api/me/library/starter` returns `available: false` with no error, so the UI
simply never shows the button — it looks like the feature doesn't exist.

**Why:** missing configuration is deliberately silent (fails closed, source identity
is server-only and never caller-selectable). Debugging "the button is gone" starts at
the env var, not the code.

**How to apply:** after environment resets or new deploys, verify the env var is set
(the operator's Lore user id, historically `1`) and restart the API server. Copies are
additive with `onConflictDoNothing` on (userId, mbid) and insert provenance
`{kind:"import", service:"matt-starter"}` — rows render in the Stack with an
"imported from matt-starter" byline. A successful copy busts crossings, library-hit,
and picker-overlap caches.
