---
name: Spotify import fetch timeout
description: Node.js fetch hangs indefinitely under Spotify rate-limits; must use AbortController with explicit timeout on every page fetch.
---

## Rule
Every `fetch()` call in the Spotify `importLibrary` generator must be wrapped in an `AbortController` with a hard timeout (20 s). Do NOT rely on Spotify returning a 429 — under sustained rate-limit pressure it can simply hang the TCP connection with no response.

## Why
After 6 failed/partial import attempts in rapid succession, Spotify began hanging connections rather than returning 429. The import worker had no timeout, so it sat at `status=running, phase=fetching, total=0` indefinitely with zero log output, appearing frozen. `total` never updated because the first `fetch()` call never returned.

## How to apply
Use a local `fetchWithTimeout(url)` helper inside the generator:
```ts
const fetchWithTimeout = (u: string) => {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 20_000);
  return fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: ac.signal })
    .finally(() => clearTimeout(timer));
};
```
Catch `AbortError` and rethrow as a human-readable error. Also add a small inter-page delay (300 ms) as proactive throttling to avoid accumulating rate-limit debt across 60+ pages.

## Companion fixes
- Add 429 retry with exponential backoff (up to 4 attempts, honour Retry-After)
- Pause `useSpotifyHistorySync` in the browser while an import is active (same token competes)
- Concurrent job guard: 409 if a running/pending job already exists
- `FETCH_STAMP_INTERVAL = 50` so UI updates after every Spotify page (not every 2)
