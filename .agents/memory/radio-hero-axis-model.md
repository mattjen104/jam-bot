---
name: Radio hero axis model
description: The interaction and information hierarchy chosen for Lore Radio's front-door station heroes.
---

The front door uses a full-left vertical station sidebar below the page hero copy. The current station is a fixed, enlarged square at the top of that sidebar and forms one hero row with its Now Playing card directly to the right. Only the other stations scroll vertically beneath the current tile. Lifetime crossing covers scroll horizontally inside the hero card.

**Why:** The current station needs a stable, unmistakable hero position while the remaining stations act as a scrubber. Separating the fixed current tile from the scrolling list prevents the rail from painting over the page headline and makes the relationship between station identity and Now Playing immediate.

**How to apply:** Keep the sidebar flush to the viewport’s left edge and start it below the page hero. Render the current station outside the scrollable scrubber, then place icon-only up/down chevrons and smaller station tiles beneath it. Selecting a tile promotes it to the fixed current position without starting playback. Keep Now Playing directly to the right of the current tile and load large crossing histories on demand rather than bloating every Dial response.