---
name: Playwright executablePath placement
description: executablePath must live in use.launchOptions, not directly under use
---
Rule: in playwright.config.ts, `executablePath` is only honored inside `use.launchOptions`. Placing it directly under `use` (or a project's `use`) is silently ignored — Playwright then tries the downloaded `chrome-headless-shell`, which doesn't exist in this NixOS env, and every test fails at `browserType.launch` in ~1ms.

**Why:** the lore e2e suite ran only via interstitialTone for months because that spec sets its own `test.use({ launchOptions: { executablePath } })`; the shared config's top-level `executablePath` never worked, so all other specs appeared uniformly broken.

**How to apply:** any new Playwright config or project must spread the `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`/`NIX_CHROMIUM_PATH` fallback inside `launchOptions: { ... }`. A symptom of getting this wrong: every test fails instantly with "Executable doesn't exist at .cache/ms-playwright/...".
