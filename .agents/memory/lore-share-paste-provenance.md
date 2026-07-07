---
name: Lore share/paste provenance rule
description: When the jam-bot link-unfurl paste path writes to recordings vs returns links-only, and how Qobuz is surfaced.
---

# Paste-to-share provenance

**Normal rule:** a pasted song is never written to `recordings`. The DB FK
(`spins.mbid → recordings.mbid`) ensures any song with station history is already
persisted by the ingest pipeline and resolves as a `kind:"lore"` card. Anything not
in the library never aired and returns `kind:"links-only"`, no write.

**Defensive exception (step 3b):** if MBID resolution succeeds but `getSongShare`
returns null, the code checks `spins` directly for station history. A hit means an
ingest-pipeline integrity gap — the function upserts from available metadata and
returns a Lore card. This path should never fire and emits a `console.warn` when it
does, so it is visible in logs.

**Link set rule:** `song.links` in the API response is already the full merged set
(exact deep-links first, then search fallbacks for uncovered services incl. Qobuz).
The Slack card must render `song.links` in full — never filter to exact-only or
truncate — so Qobuz is always present. Search fallbacks are labeled
"Search <Service>" to be honest about confidence.

**Why:** Qobuz is position 8+ in the exact-link list, so any `slice(0, 5)` or
exact-only filter silently drops it from the Slack card.
