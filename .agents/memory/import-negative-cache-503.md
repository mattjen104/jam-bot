---
name: Import Phase 3 negative cache on MB 503
description: Why MB rate-limit errors silently poison the resolution cache, and the correct guard.
---

## The rule

Phase 3 of `runImportWorker` must NOT write a negative cache entry (`mbid: null`) when the resolver threw an exception. Use a `resolveErrored` flag to distinguish MB errors from genuine not-found results.

```ts
let resolveErrored = false;
try {
  mbid = await mbResolver.resolveByText(artist, title, signal);
} catch {
  resolveErrored = true; // MB 503 / network error — not a confirmed miss
}

// Only confirmed misses (null + no error + not aborted) get cached as null:
} else if (!controller.signal.aborted && !resolveErrored) {
  // write negative cache entry
}
```

**Why:** When MB returns 503 quickly (before the 12s abort timer fires), the resolver throws, `mbid` stays `null`, and the signal is NOT aborted. The old code's `else if (!signal.aborted)` branch then writes `mbid: null` to `resolution_cache`. Future imports see `hit === null` in Phase 2 and mark the track as a confirmed miss — permanently skipping it. A burst of 503s (e.g., from concurrent import workers) can incorrectly cache hundreds of tracks as permanent misses.

**How to apply:** The `resolveErrored` flag is already in the code (added July 31, 2026). Do not remove it. If the resolver is refactored to return a richer result type, replace the flag with an explicit `"error" | "miss" | string` discriminated return.

## Recovery from an existing poisoned cache

If negative cache entries were already written due to 503 errors, delete them:

```sql
DELETE FROM resolution_cache
WHERE mbid IS NULL
  AND created_at >= '<date of the bad import run>';
```

Then start a new import — Phase 3 will retry the cleared tracks. Tracks with genuine MB misses will be re-cached as null (correctly this time, since no error occurs).
