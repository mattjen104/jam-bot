---
name: Compact home fast lane
description: Keep the minimal Lore home responsive while the full radio read models are busy.
---

The compact `/` surface should load only station identity/live pulse and its small first-play archive read. Defer schedule attribution, recent-spin history, artist-frequency work, and personalized crossing recomputes to the richer `/feed` and `/library` surfaces.

**Why:** Full-Dial enrichment combines expensive schedule-attribution and crossing aggregates. Starting those queries alongside home data can make simple listener reads queue or time out, leaving the first-play rail and Stack empty even when their underlying data exists.

**How to apply:** Treat the home as a fast lane: preserve station browsing, tune-in, scan selection, and skip behavior, but make advanced enrichment opt-in for the full views. The home first-play read should use its dedicated lightweight server path, avoiding station-directory fan-out and schedule validation that the cards do not display.