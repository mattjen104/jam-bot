---
name: Home on-air stable cells
description: The home discovery list treats cell position as part of a live card's identity.
---

Rule: On the home “On the air” list, an unchanged station card keeps its visible position while background enrichment and source refreshes arrive. A listener-initiated scope change may reorder the list.

**Why:** sorting every live refresh made stations visibly jump while the same song was still playing. The desired radio behavior is physical: a station remains where the listener saw it until that card changes.

**How to apply:** preserve visual position across passive refreshes; allow reordering only when the visible card meaningfully changes or the listener changes scope.