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

- Wrap renders in a `QueryClientProvider` (fresh `new QueryClient({defaultOptions:{queries:{retry:false, enabled:false}}})`): some components (e.g. KeepButton via meHooks) call `useQuery` from @tanstack/react-query directly, bypassing the mocked barrel, and crash with "No QueryClient set".
- Barrel-mock breakage is the usual failure mode when pages grow new hooks: any new `useGetX`/`getGetXQueryKey` used anywhere in the tree must be added to every test file's `vi.mock` factory or ~20 tests fail with "No export is defined on the mock".

**Gotcha — memoryLocation searchPath must NOT start with `?`.**
**Why:** wouter joins `path + "?" + searchPath`; a leading `?` yields `path??query`, and its `split("?")` destructuring then reads the search as empty — pages silently see no query params and tests fail mysteriously (renders fine, params absent).
**How to apply:** pass `searchPath: "play=1&from=x"` (bare), and prefer `static: true` for read-only page tests.

**Gotcha — no RTL auto-cleanup (vitest globals are off).** Render containers
accumulate across tests AND across vitest retries of the same test, so
`screen.getByText` sees duplicates ("Found multiple elements") or stale DOM.
**How to apply:** add `afterEach(cleanup)` from `@testing-library/react`, and
scope assertions to the render result (`const view = render(...)` →
`view.getByText`) instead of `screen` when a file mixes `renderHook` +
`render`.

**Gotcha — `bail: 1` + `retry: 1` mask stale specs.** The lore vitest config
bails the whole suite on the first failure, so a summary like "1 failed |
5 passed (10)" means the other 4 were SKIPPED, not passing — and one stale
file hides every stale file behind it.
**Why:** diagnosing the front-door rework fallout looked like a single
mixed-case bug until `-t` isolation showed every spec in the describe was
stale (the UI element no longer existed for any of them).
**How to apply:** when a suite or describe shows an odd pass/fail split,
rerun with `--bail=0` (whole suite) or `-t '<name>'` (single test) before
concluding only the reported test is broken; assume same-file siblings
sharing the stale selector are broken too.
