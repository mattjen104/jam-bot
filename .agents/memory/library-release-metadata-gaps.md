---
name: Library release metadata gaps
description: How the Stack should recover album titles and covers when saved recordings lack release-group bridge rows
---

Saved recordings cannot be assumed to have a primary `recording_release_groups` row, even in a large established library. The Stack should progressively hydrate missing release identity through rate-limited, batched MusicBrainz recording lookups.

**Why:** A real development library had roughly 1,900 resolved saves but only 29 recordings with release-group metadata. Rendering only stored album fields made nearly every card say “Album unknown,” while most missing-art cards had no fallback source.

**How to apply:** Batch recording-ID lookups (up to 100), serialize requests to respect MusicBrainz limits, prefer the earliest plain Album release group, derive CAA art from the recovered group MBID, and retain a bundled local image when no cover exists.