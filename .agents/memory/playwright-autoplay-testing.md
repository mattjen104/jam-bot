---
name: Playwright autoplay-policy testing confounds
description: How to genuinely test browser autoplay policy in Playwright/Chromium — three defaults silently allow autoplay and make tests tautological.
---

Testing whether `audio.play()` is allowed under real autoplay policy in Playwright requires neutralising three confounds, each of which silently makes autoplay always-allowed:

1. Playwright's default Chromium switches include `--autoplay-policy=no-user-gesture-required`. A later duplicate flag wins in Chromium, so passing your own flag in `args` is NOT enough — strip the default via `ignoreDefaultArgs`.
2. Playwright adds `--mute-audio`; Chromium always allows *inaudible* playback, so a muted browser lets everything autoplay. Strip it too.
3. `page.evaluate` runs with CDP `userGesture: true`, granting transient user activation to whatever it executes. Playback attempts must run from `addInitScript` page scripts or deferred `setTimeout` callbacks (>5s to outlive transient activation); use evaluate only to arm/read.

**Findings (Chromium 138, `--autoplay-policy=user-gesture-required`):** transient activation (~5s window) governs a fresh `Audio()`; sticky activation alone is not honoured under the strict flag (it IS under default Chrome policy). An element pre-unlocked (play+pause) inside the gesture handler still plays after the window expires.

**Applied fix:** the crossing tone is now pre-unlocked (muted play+pause on a dedicated element) inside the gesture handler and the interstitial effect reuses that element, so the tone survives a >5s device check under the strict flag. Fresh-Audio fallback + fail-open dismiss remain the backstop.

**How to apply:** see `artifacts/lore/e2e/interstitialTone.spec.ts` — always include a no-gesture control test that must be blocked, or the positive result proves nothing.
