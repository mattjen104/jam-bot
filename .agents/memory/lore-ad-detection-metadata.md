---
name: Cheap ad detection via metadata, not audio
description: How Lore flags stations that may air ads without adding audio-analysis cost.
---

Longtail ICY/RadioBrowser stations frequently announce ad breaks straight
in their StreamTitle/now-playing metadata (e.g. "this station will
continue after this break", a sponsor read, network promo, or — for
same-field-filler ICY implementations — identical artist/title text like
"Advert: — Advert:" or "ESPACIO PUBLICITARIO — ESPACIO PUBLICITARIO").

Because the poller already fetches this metadata every tick, a regex
scan over it (`artifacts/api-server/src/lore/ads.ts`) catches the
majority of ad breaks for free — no extra audio capture, fingerprinting,
or third-party ad-detection service needed.

**Why:** audio-based ad detection would add real infra cost (capture +
analysis pipeline) for a feature that's just a soft "may have ads" hint,
not a hard guarantee — the metadata signal is cheap and good enough.

**How to apply:**
- Run detection *before* dedup/early-return logic in the spin-logging
  path, not after — dedup would otherwise suppress a repeated identical
  ad slug before it ever gets counted, defeating a streak-based signal.
- Require N consecutive ad-like signals (not 1) before flagging, to avoid
  mislabeling a station on a single coincidental title match.
- Keep the flag sticky once set (don't auto-clear) — the point is "this
  station is known to run ads," not "an ad is airing right now."
- The regex approach is English-phrase-biased; non-English ad language
  only gets caught via the same-field-filler heuristic when it also
  matches an English promo keyword. Accepted tradeoff for the "cheap"
  requirement — do not scope-creep into per-language pattern lists.
