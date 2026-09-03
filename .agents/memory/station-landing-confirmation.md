---
name: Station landing confirmation
description: The trust boundary between aggregate now-playing freshness and station-specific tune confirmation.
---

An explicit station landing must remain in a checking or delayed state until a station-specific refresh completes and produces an observation at or after that landing began. Aggregate freshness alone never confirms a landing.

**Why:** A recently cached aggregate row can still be the previous song at the moment a listener tunes. Station-global timestamps also let rapid or cross-client landings inherit another landing's confirmation.

**How to apply:** Correlate refresh state to both station and landing identity, let concurrent landings join only a refresh that will observe after they began, and keep audio startup independent from metadata confirmation.