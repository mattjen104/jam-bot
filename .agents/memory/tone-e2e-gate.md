---
name: Crossing-tone e2e merge gate
description: How the autoplay-policy browser test is wired into validation and its environment preconditions
---
The interstitialTone Playwright spec runs as validation step `tone-e2e` via `e2e/run-interstitial-tone-gate.sh` in the lore artifact (`test:e2e:tone-gate` script, flock `/tmp/lore-e2e.lock`).

**Why:** a Chromium policy change or a PlayerProvider unlock refactor would silently reintroduce the tone silent-skip; jsdom can't see autoplay policy.

**How to apply:** the gate fails loudly (never skips) when Chromium or the lore dev server is missing. It resolves Chromium via PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH or `command -v chromium` (system nix Chromium works). It requires the `artifacts/lore: web` workflow to be running and curl-checks both `/lore/` and the tone asset before running Playwright — restart that workflow before trusting a gate failure.

**Environment constraint:** the gate's positive click-gesture specs depend on Chromium's transient-activation window and can time out under container load independent of code changes — always confirm a failure reproduces on an unmodified tree before treating it as a regression.

**Pre-existing boundary-test failure (Aug 2026):** the spec "pre-unlocked tone element still plays >5s later" (interstitialTone.spec.ts:249) fails on main independent of code changes — `played=false` despite sticky activation; Chromium in this environment no longer honors the muted-play pre-unlock past the transient-activation window. Verify against the parent commit before blaming your change; if it fails there too, complete with a documented skip_validation_reason and don't burn task time re-debugging it from an unrelated task.
