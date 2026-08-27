---
name: Home on-air stable cells
description: The home discovery list treats cell position as part of a live card's identity.
---

Rule: home has one unified “On the air” list. An unchanged card keeps its exact cell while enrichment and source refreshes arrive; a scope change releases the ordering. New or changed cards fill available cells, and empty cells retain their height.

**Why:** sorting every live refresh made stations visibly jump while the same song was still playing. The desired radio behavior is physical: a station remains where the listener saw it until that card changes.

**How to apply:** compare stable spin/card identity before placement signals. Resolution IDs and refreshed timestamps alone do not release a cell; unchanged visible track text remains the same card. At the “now” scope, rank each station by its closest positive interval (now → set → 24h → 7d → lifetime), then count. Other scopes use their exact count. Test position across multiple live refreshes, not only a single render.