---
name: Home on-air stable cells
description: The home discovery list treats cell position as part of a live card's identity.
---

Rule: an unchanged home on-air card keeps its exact cell while enrichment and source refreshes arrive. New or changed cards fill available cells; empty cells retain their height instead of pulling later cards upward.

**Why:** sorting every live refresh made stations visibly jump while the same song was still playing. The desired radio behavior is physical: a station remains where the listener saw it until that card changes.

**How to apply:** compare stable spin/card identity before placement signals. Resolution IDs and refreshed timestamps alone do not release a cell; unchanged visible track text remains the same card. Test position across multiple live refreshes, not only a single render.