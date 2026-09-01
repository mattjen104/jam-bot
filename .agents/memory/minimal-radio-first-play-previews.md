---
name: Minimal radio first-play previews
description: Data-source boundary for first-play artwork and counts in compact station cards
---

Compact station cards should load first-play artwork from the existing station-filtered player history read model, rather than expanding the crossings response with another album collection. The card's lifetime first-play heading remains the server-provided crossings aggregate, while the artwork rail is a bounded recent preview.

**Why:** The history endpoint already returns resolved artwork and applies the same authenticated first-play/crossing semantics without creating a second response contract.

**How to apply:** When changing this card, preserve the station filter, bounded limit, timeout, graceful empty state, and separate expansion state for crossing albums and first-play previews.