---
name: Minimal radio first-play previews
description: Data-source boundary for first-play artwork and counts in compact station cards
---

Compact station cards should load first-play artwork and newest-event timestamps from the existing station-filtered player history read model, rather than expanding the crossings response with another album collection. Both insight headers pair a server-provided lifetime-count badge with the newest lifetime event's local date and time; artwork remains bounded to the latest five results.

**Why:** The history endpoint already returns resolved artwork and applies the same authenticated first-play/crossing semantics without creating a second response contract.

**How to apply:** When changing this card, preserve the lifetime scope, station filter, bounded limits, timeout, graceful empty state, and separate expansion state for crossing albums and first-play previews. Prefer a live crossing's source time when it is newer than archive history.