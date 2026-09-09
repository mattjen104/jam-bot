---
name: Crate release metadata is server-side
description: Crate album metadata resolves through a server-owned endpoint that hydrates a shared DB cache; the browser never calls musicbrainz.org
---

The Library crate must never call musicbrainz.org from the browser; release metadata resolves through a server endpoint backed by a shared, persisted cache (`recording_release_groups`) so hydration cost is paid once globally.

**Why:** Per-browser MB trickle (~1 req/1.1s for a ~1,900-keep library) made every page load churn for minutes. Server-owned caching converges the shared table instead of repeating the same upstream crawl per session.

**How to apply:** New crate/library metadata needs go through the server, not direct upstream calls. Treat transient upstream failures (5xx, timeouts) as retryable; only definitive misses may be negatively cached. MB recording-*search* projections carry title/date on the release, not the nested release-group — parse with release-level fallback.
