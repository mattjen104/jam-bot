---
name: Broadcast timing provenance
description: Durable rules for honest live-track countdowns and boundary handling.
---

Receipt or persistence timestamps must never be interpreted as track-start
timestamps. Live timing carries explicit source, fingerprint, inferred, or
receipt provenance plus a bounded uncertainty; legacy rows with unknown
provenance degrade to inferred.

**Why:** A precise-looking countdown built from mixed timestamp semantics is
less trustworthy than omitting it, especially with station polling delay and
incorrect listener clocks.

**How to apply:** Keep expiry advisory. Use aligned server time and uncertainty
for display and recheck scheduling, but only a fresh metadata response that
identifies a different track may change the displayed or playing track. Keep
large historical timing migrations schema-only; read-time fallback avoids a
boot-blocking rewrite. ACR `play_offset_ms` applies at the end of the recognized
clip, so anchor it to capture end; the clip midpoint is diagnostic only.