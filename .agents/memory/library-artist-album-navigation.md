---
name: Library artist-to-album navigation
description: Product rule for presenting a track-backed library through artist and album navigation.
---

The library remains track-backed: radio keeps and imported songs stay as individual saved items with their provenance and timestamps. Artist Document artists join those track-backed artists in one case-insensitively deduplicated index.

**Why:** Artist mode is a compact navigation index, not another track presentation. It should make the combined taste collection scannable without album art or representative-song bias.

**How to apply:** Sort Artist mode A–Z. Render one plain row per artist with no artwork or track title. Keep albums hidden until the artist row is clicked, then reveal album names only—never tracks or covers. Seed-only artists remain valid rows even when Lore has no saved album for them. Removing an artist from active tuning/library membership must not delete underlying saved tracks.