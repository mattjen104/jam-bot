---
name: Lore UI component tests (jsdom + RTL + wouter memoryLocation)
description: How to write React component tests in artifacts/lore, and the wouter memoryLocation searchPath gotcha.
---

# Lore UI component tests

The lore vitest suite defaults to `environment: "node"`; UI tests opt into jsdom per-file with a `// @vitest-environment jsdom` pragma. `vitest.config.ts` sets `esbuild: { jsx: "automatic" }` so `.tsx` tests need no React import; `tsconfig.json` excludes `**/*.test.tsx` from typecheck like the `.ts` tests. See `test/replayDeepLink.test.tsx` as the reference pattern.

**Recipe:**
- `vi.mock("@workspace/api-client-react", ...)` the whole barrel, stubbing every VALUE import used anywhere in the rendered tree (PlayerProvider pulls ~8 fns, useSpotifyConnect pulls getSpotifyStatus/spotifyLogout). Type-only imports don't matter.
- Stub `HTMLMediaElement.prototype.play/pause/load` (jsdom's are not implemented; `play()` returning non-Promise crashes `.play().catch(...)` call sites).
- Route pages with `<Router hook={hook} searchHook={searchHook}>` from `memoryLocation(...)` (`wouter/memory-location`).

**Gotcha — memoryLocation searchPath must NOT start with `?`.**
**Why:** wouter joins `path + "?" + searchPath`; a leading `?` yields `path??query`, and its `split("?")` destructuring then reads the search as empty — pages silently see no query params and tests fail mysteriously (renders fine, params absent).
**How to apply:** pass `searchPath: "play=1&from=x"` (bare), and prefer `static: true` for read-only page tests.
