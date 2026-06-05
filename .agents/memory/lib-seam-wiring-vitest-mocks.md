---
name: Shared-lib seam wiring vs. vitest source mocks
description: Why a host's global test-setup wiring of a shared lib can silently defeat per-file vi.mock of that lib's internal modules, and the narrow-entry fix.
---

# Shared-lib seam wiring must not import the barrel in vitest setup

When enrichment logic was extracted into `@workspace/song-enrichment` and jam-bot
kept its unit tests that `vi.mock` the lib's internal data-source modules
(musicbrainz/discogs/lastfm/wikipedia/genius), the mocks silently stopped
intercepting: subjects (`enrichTrack`/`enrichContext`/`getInsightsFor`) ran the
REAL collaborators even though the test's own handles showed `isMock: true`.

## Root cause (took several wrong turns to find)
`test/setup.ts` ran `wireEnrichment()` which imported the lib **barrel**
(`@workspace/song-enrichment` → `index.ts`). The barrel `export *`s every subject
module, so importing it **eagerly evaluates** `context.ts`/`knowledge.ts`/etc and
**pins their collaborator bindings**. `setupFiles` run BEFORE the test module, so
this happened before the test file's hoisted `vi.mock` calls. vitest then serves
the already-evaluated cached subject, so the later mock never reaches it. The
test's own `await import(collaborator)` got the freshly-mocked copy → two views.

## What did NOT matter (red herrings)
- `server.deps.inline` — irrelevant; lib files imported by relative path are
  already transformed by vite.
- A `resolve.alias` collapsing the package to its real source path — didn't help,
  because the problem was evaluation ORDER, not module-id duplication.
- Repointing the `vi.mock` targets / importing the subject from the real `lib/...`
  path instead of the shim — necessary but insufficient on their own.

## The fix
Give the lib a **narrow wiring entry** (`./wiring` subpath export) that re-exports
ONLY the leaf seams (`configureEnrichmentCache/Spotify/Summarizer`,
`setEnrichmentLogger`) — none of which import any subject module. Host wiring
(`enrichment-wiring.ts`, api-server) imports from `@workspace/song-enrichment/wiring`,
NOT the barrel. Now setup wires deps without evaluating subjects, so each test's
`vi.mock` registers first and the subject (imported after) binds the mocks.

**Why:** keeps global seam wiring in test setup (per the task spec) while letting
per-file source mocks work.
**How to apply:** any time a host configures a shared lib's injectable seams in a
global vitest `setupFile`, route that wiring through a leaf-only entry; never the
barrel that re-exports the modules tests want to mock. Also import the
code-under-test and its mocked collaborators from the SAME resolution root.
