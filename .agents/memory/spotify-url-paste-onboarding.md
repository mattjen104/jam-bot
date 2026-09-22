---
name: Spotify URL-paste onboarding
description: Product decision for the primary Spotify Library import path during first-run onboarding.
---

Use bulk-pasted Spotify track URLs copied from the Spotify desktop app as the primary onboarding import method. Treat Spotify account connection as a secondary option rather than the required front door.

**Why:** A full multi-selection in Spotify desktop produces stable track URLs, avoids making account authorization the first-run requirement, and maps directly to the provider identities Lore already retains during Library resolution.

**How to apply:** Accept newline- or whitespace-separated Spotify track URLs, deduplicate IDs, show validation and progress, hydrate metadata in bounded batches, preserve unresolved tracks, and run the existing canonical resolution pipeline asynchronously.