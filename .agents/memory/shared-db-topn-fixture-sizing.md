---
name: Shared-DB top-N fixture sizing
description: DB tests for global top-N endpoints against the shared dev database must size fixtures off the live boundary, not fixed play counts.
---

DB tests that assert membership in a globally-bounded endpoint result (e.g. `LIMIT 60 ORDER BY play_count DESC`) run against the shared development database, whose real archive keeps growing. A fixture with fixed play counts silently rots: the artist-frequency fixture's 500/600 plays fell below the live 60th-place boundary (516) and the test went red on mainline for everyone.

**Why:** The failure mode is invisible until the archive crosses the fixture margin — no code change, no schema change, just data growth. "Works on my fresh DB, red in CI" with an unrelated-looking diff.

**How to apply:** In `beforeAll`, query the endpoint's own resolved set for the current Nth-place count, then bulk-insert fixture rows at boundary + margin (e.g. +400/+200) with `INSERT ... SELECT ... FROM generate_series(1, n)` (one round trip, fast at any size). Assert against the computed targets, and remember canonical-alias grouping: two recordings sharing an artist_mbid each contribute their spins to one group, so top-up counts must subtract ALL spins already in the group, not just the one recording's.
