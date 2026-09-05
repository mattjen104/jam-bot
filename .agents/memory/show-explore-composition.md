---
name: Show Explore composition
description: Durable rules for the unified radio-show discovery read model.
---

Use one primary ranking lens with composable station/location constraints. Keep live, upcoming, historically relevant shows, and station fallbacks as separate response sections; a current live occurrence must not also appear as upcoming.

**Why:** Show discovery combines evidence with different completeness and confidence. Treating missing schedule, genre, coordinates, or personalization as a negative—or inventing show identity—misleads listeners and makes partial outages look like empty discovery.

**How to apply:** Reuse bounded schedule, station-profile, crossing, and local ZIP evidence. Emit the ranking reason, supporting evidence, readiness/confidence, and timing. Preserve unattributed live broadcasts as honest station-level results and keep listener ZIPs request-scoped.