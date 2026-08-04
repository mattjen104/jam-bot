---
name: preferred-service-fallback
description: How the altDriversAllFailed flag + retryService direct-call pattern works; why the trigger effect alone can't handle retry.
---

# Preferred-Service Live Fallback Pattern

## Rule
When `preferredService` (YouTube/Apple Music) is selected and all drivers fail, set `altDriversAllFailed=true` immediately inside YouTube's `.catch()` handler in `tryAltDriverRef` (not in the "exhausted branch" which is only reached on a second entry). Also set it in the YouTube subscription `"unavailable"/"error"` handler for async failures after `play()` resolved.

**Why:** YouTube's `.catch()` is the real termination point of the cascade. The "exhausted branch" at the bottom of `tryAltDriverRef` only fires if both `am:mbid` AND `yt:mbid` are already in `altDriverFailedRef` when `tryAltDriverRef` is *entered* — that never happens on the first call.

## Live Broadcast Resume
`effectiveFallbackUsed = fallbackUsed || altDriversAllFailed` gates `resumeLiveRadio` in the live fallback effect. This covers the preferredService path where Spotify is never attempted and `fallbackUsed` stays false.

## Retry Must Call the Cascade Directly
`retryService` must call `tryAltDriverRef.current(mbid, item, skipApple)` directly — do NOT rely on the preferred-service trigger effect re-firing. After a failure, `altDriverActiveMbid` is already `null` and `driverActive` is already `false`, so clearing `altDriversAllFailed` doesn't change any effect deps and the effect won't re-run.

**How to apply:** Any time you add a "retry" for an alt-driver path, call the cascade ref directly inside the callback rather than setting state and hoping an effect picks it up.

## Code Locations
- `tryAltDriverRef` assignment: `PlayerProvider.tsx` — YouTube `.catch()` + exhausted branch
- YouTube subscription failure handler: `PlayerProvider.tsx` — `"unavailable"/"error"` branch  
- `retryService` callback: `PlayerProvider.tsx` — calls `tryAltDriverRef.current` directly
- Tests: `test/preferredServiceLiveFallback.test.ts` — cascade simulator + effectiveFallbackUsed logic + retry round-trip

## Review Pitfalls Caught
1. First review: `preferredService` path never called `resumeLiveRadio` → fix: `altDriversAllFailed` flag.
2. Second review: `retryService` cleared state but effect didn't re-fire → fix: direct cascade call.
3. Third review: `rideFallbackLabel` called without service arg → fix: pass `preferredService ?? "spotify"`.
4. Fourth review: pre-existing DialView failures (from sibling task) blamed on this diff → resolved via `skip_validation_reason` documenting the pre-existing baseline.
