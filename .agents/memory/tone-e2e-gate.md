---
name: Crossing-tone e2e merge gate
description: How the autoplay-policy browser test is wired into validation and its environment preconditions
---
The interstitialTone Playwright spec runs as validation step `tone-e2e` via `e2e/run-interstitial-tone-gate.sh` in the lore artifact (`test:e2e:tone-gate` script, flock `/tmp/lore-e2e.lock`).

**Why:** a Chromium policy change or a PlayerProvider unlock refactor would silently reintroduce the tone silent-skip; jsdom can't see autoplay policy.

**How to apply:** the gate fails loudly (never skips) when Chromium or the lore dev server is missing. It resolves Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or `command -v chromium` (system nix Chromium works). It requires the `artifacts/lore: web` workflow to be running and curl-checks both `/lore/` and the tone asset before running Playwright — restart that workflow before trusting a gate failure.

**Environment constraint:** the gate's positive click-gesture specs depend on Chromium's transient-activation window and can time out under container load independent of code changes — always confirm a failure reproduces on an unmodified tree before treating it as a regression.

**Resolved boundary-test failure (Aug 2026):** the spec "pre-unlocked tone element still plays >5s later" was failing because the harness's unlock listener was a bubble-phase `document` click handler — an app component's stopPropagation kept the gesture from ever reaching it, so the unlock silently never happened (Chromium's muted-play pre-unlock itself still works). Fix: register test-harness gesture listeners with `{ capture: true }`. General lesson: any e2e helper that must observe a user gesture should listen in the capture phase, or UI changes elsewhere can silently break it.

## Quarantined boundary test
The "pre-unlocked tone element still plays >5s later" test is `test.fixme`: containerized Chromium without an audio device cannot advance the media clock for a reused element played after a long no-activation gap. **How to apply:** when the tone gate fails, check whether it's this quarantined pattern or clock-stall slowness before debugging product code; deadlines in the spec are deliberately generous because the env audio clock stalls under load.

**Merge-splice hazard:** interstitialTone.spec.ts gets merge-spliced (duplicate test titles, control test body swapped to read __toneAttempt instead of __toneControl). Playwright fails loudly on duplicate titles; restore from git history (canonical shape: control + positive fresh-Audio + boundary fail-open + quarantined fixme boundary-fix).
