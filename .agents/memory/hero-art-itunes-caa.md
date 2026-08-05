---
name: Hero art — iTunes fuzzy search vs CAA release-exact
description: Why iTunes Search can't be trusted for album art without title/artist validation, and how to get a release-exact CAA 1200px URL from library artwork URLs.
---

**Rule:** Never use an iTunes Search result's artwork without validating `collectionName`/`artistName` against the library album (exact normalized match, allowing only the "- Single"/"- EP" suffix). Prefer a release-exact CAA URL when one can be derived.

**Why:** Verified with a real library: "Yeah Yeah Yeahs — Spitting Off the Edge of the World" has no exact iTunes match; the fuzzy search returns the "(Lush Version)" single with completely different cover art. Remixes, deluxe editions, and cover artists all collide this way.

**How to apply:**
- Library artwork URLs are usually CAA mirrors on `*.archive.org` whose path embeds the release MBID (`mbid-<uuid>-…_thumb500.jpg`). `coverartarchive.org/release/<uuid>/front-1200` serves the same cover as a true 1200px master — guaranteed correct.
- archive.org is unreachable from the dev container (curl 000; art proxy 302s through). coverartarchive.org IS reachable — so proxy CAA URLs work in-container, raw archive.org URLs don't. Screenshots showing RUMOURS fallback art may be a container-egress artifact, not a bug.
- Every hero/art fetch needs an explicit `AbortSignal.timeout` — a hung fetch leaves the candidate chain (and the UI) stuck on fallback forever.
- The recurring 502 in lore browser logs is the vite dev-banner script + favicon, not an app endpoint.
- For interactive/visual verification headless: Screenshot tool races async art probes; drive chromium over CDP (ws from node_modules/.pnpm) to wait, read DOM, and capture.
