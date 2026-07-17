---
name: MB chain starvation & isolated resolver
description: Why the library import hangs — shared mbChain starved by enrichment pipeline — and how the isolated resolver + AbortSignal ghost-exit + Phase 3 budget fix it.
---

## The rule

Never let the import worker share the enrichment pipeline's `mbChain`. Give it its own isolated resolver. Add a wall-clock budget to Phase 3 so imports always terminate.

**Why:** `mbChain` in `lib/song-enrichment/src/musicbrainz.ts` is a process-wide serial queue. Dozens of station pollers (enrichment pipeline) continuously push MB requests onto it. The import worker's calls join the back of that queue. `Promise.race` with a timeout doesn't help — when the race fires, the original call stays queued as a ghost; the next import call is added behind the ghost AND more enrichment calls. The queue grows faster than it drains. The import counter never moves.

**How to apply:**
- Import worker Phase 3 must call `createMbResolver()` (exported from `@workspace/song-enrichment`) to get an isolated chain instance.
- Pass an `AbortController.signal` to each `resolveByIsrc()` / `resolveByText()` call and `setTimeout(controller.abort, IMPORT_RESOLVE_TIMEOUT_MS)` per track. This replaces `Promise.race`.
- Ghost slots check `signal.aborted` at the start of their chain slot and exit in O(1) — no sleep, no network call.
- `PHASE3_BUDGET_MS = 5 * 60_000`. With 3000+ tracks at 1 req/sec, Phase 3 would take 50+ min without a budget.
- `createMbResolver()` internals: uses `mbFetchOnChain(chain, path, signal?)` — a refactored helper that takes the chain as a parameter so both the shared `mbFetch` and isolated instances can reuse it.
- Write successful MB resolutions to `resolutionCacheTable` so future re-imports resolve those tracks in Phase 2 (DB-only, no MB calls).
