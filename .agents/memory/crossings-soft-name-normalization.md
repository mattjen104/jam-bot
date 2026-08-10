---
name: Crossings soft-name normalization
description: Why seed-name matching tolerates articles/punctuation, why it must stay Unicode-safe, and why empty crossings results expire fast.
---

**Rule:** Soft artist-name matching (taste seeds, unresolved Spotify) must normalize BOTH sides symmetrically — strip a leading English article and punctuation/whitespace only — never strip non-ASCII letters.

**Why:** Seed "Clash" never matched spins credited to "The Clash", producing a false "none of your artists played" nudge. A first attempt used `[^a-z0-9]` stripping, which silently broke all CJK/Cyrillic/Arabic artist matching (code review caught it) — use POSIX `[[:space:][:punct:]]` classes instead. Names that normalize to empty (e.g. "The") must be nulled out or they wildcard-match other blank names.

**How to apply:** Any future name-matching site (blended compute, live hit badges, lifetime job) should reuse the same normalization or it will disagree with the personal dial. Empty crossings results deliberately expire fast (minutes, not the 30-min TTL) so a user's first matching spin surfaces promptly; the SWR path still serves the stale empty once, so tests must poll for the refresh.
