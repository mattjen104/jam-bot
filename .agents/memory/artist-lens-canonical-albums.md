---
name: Artist lens canonical albums
description: Which album sources belong in a focused Library artist lens
---

A focused Library artist lens must merge personal `/me/albums` rows with canonical albums from the exact artist-MBID endpoint. A canonical imported album belongs in the lens even when importing it did not create a personal Library keep.

**Why:** Public collection import can establish a canonical recording→release-group album without changing listener taste rows. Filtering only `/me/albums` by artist name then falsely reports “No albums” for an album Lore just imported.

**How to apply:** Carry the focused artist MBID into album views, query canonical artist albums by that ID, merge by release-group MBID, and use name filtering only as the fallback for personal rows when no canonical ID is available.