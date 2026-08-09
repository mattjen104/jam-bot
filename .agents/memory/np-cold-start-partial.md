---
name: Now-playing cold-start strategy
description: Design rules for keeping the dial responsive right after a server restart
---

- **Rule:** any expensive shared read model must be (a) prewarmed at boot, (b) single-flight at EVERY stage — including the cheap fallback query — and (c) able to serve a degraded-but-honest partial past a short deadline that clients recover from on their next poll.
- **Why:** during boot the DB pool is saturated by migrations/pollers/prewarm, so even a trivial SELECT can take seconds; a fallback that issues its own query re-creates the latency it was meant to hide. Sharing one in-flight promise per stage is what actually bounds the cold path.
- **How to apply:** expired cache entries are served stale-while-revalidate (only a truly empty cache takes the partial path); partial responses use nulls, never fabricated data; failure of the shared query propagates (500) rather than silently emptying the dial.
