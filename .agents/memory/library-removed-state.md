---
name: Library removed/active state
description: Soft-remove semantics for library tracks and the exclusion rule every taste surface must follow.
---

Rule: `removed_at IS NULL` = active, on BOTH `library_items` and `spotify_library_items`. Nothing is ever deleted — removal only stamps the timestamp; removed rows stay visible in the Library (gray, "removed"). Deselect must NEVER call Spotify unsave.

**Why:** the Library is a timeline; removed rows must stop counting toward taste everywhere at once, or a "deselected" track keeps driving recommendations and highlights.

**How to apply:** there is NO central active predicate. Any query that treats library membership as taste (crossings, library hits, picker matching, affinity, player kept-state, soft-artist matching) must filter `removed_at IS NULL` explicitly, and remove/restore must bust the server caches (crossings, library-hit, picker-overlap) and the client taste query keys.

Lifecycle: soft→resolved promotion must carry removed_at forward; imports use insert-do-nothing so they never reactivate a removed row; an explicit keep deliberately restores (clears removed_at).
