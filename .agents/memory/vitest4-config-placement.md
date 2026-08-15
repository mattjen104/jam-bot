---
name: Vitest 4 config placement traps
description: Options that Vitest 4 silently ignores — cacheDir under test, environmentMatchGlobs — and the supported replacements.
---

Two Vitest 4 (4.1.x) config traps that fail SILENTLY (config loads fine, option does nothing):

1. **`test.cacheDir` is ignored.** Cache location is Vite's top-level `cacheDir`
   (sibling of `test:` in `defineConfig`), not a `test` option. Verify by deleting
   the target dir, running one test file, and checking the dir was created —
   otherwise the cache silently lands in `node_modules/.vite/vitest`.

2. **`environmentMatchGlobs` was removed in Vitest 4.** The supported replacement
   is `test.projects`: one project per environment with its own `include` glob and
   `environment`, each using `extends: true` to inherit root resolve/esbuild config
   and shared test options (retry/bail/timeouts). Per-file
   `@vitest-environment` pragmas still work and override.

**Why:** both options accept unknown keys without warning; the only proof a config
option took effect is observing its behavior (cache dir appears, unannotated .tsx
test gets a DOM).

**How to apply:** whenever touching vitest configs in this repo, keep `cacheDir`
top-level and use the jsdom/node project split in the lore config; never reintroduce
`environmentMatchGlobs`.
