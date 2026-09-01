---
name: Minimal radio first-play previews
description: Data-source boundary for first-play artwork and counts in compact station cards
---

Compact station cards should load first-play artwork from the existing station-filtered player history read model, rather than expanding the crossings response with another album collection. Both insight headers show only server-provided lifetime-count badges; artwork remains bounded to the latest five results.

**Why:** The history endpoint already returns resolved artwork and applies the same authenticated first-play/crossing semantics without creating a second response contract. Timestamps were intentionally removed to keep the compact header scannable.

**How to apply:** When changing this card, preserve the station filter, bounded limit, timeout, graceful empty state, and separate expansion state for crossing albums and first-play previews.