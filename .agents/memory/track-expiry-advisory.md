---
name: Track expiry estimate is advisory-only
description: Design rules for the likely-expiring signal on now-playing/fast-lane read models
---

The expiry estimate (remaining = duration − elapsed) is ADVISORY: it never changes the displayed track — only a genuinely different server track does. It only schedules one extra fast-lane re-check just past the estimated boundary (padded, capped, never self-rescheduling).

**Why:** an estimate-driven display swap would cause false "track changed" churn whenever durations or start times are slightly off; freshness classification already covers stale data. ACRCloud's `play_offset_ms` is the position within the matched ORIGINAL track at the END of the recognized clip (clip-relative offsets are the separate sample_* fields), so it must be paired with the clip-end timestamp, never capture start.

**How to apply:** position sources strongest-first: fingerprint offset+capture time > playedAt; missing duration ⇒ null estimate, no penalty; elapsed wildly past duration ⇒ null (stale, not expiring). Keep the signal on the plain-JSON fast lane, not orval payloads. Same-station relanding must supersede in-flight checks via a generation token, not just timer clearing.
