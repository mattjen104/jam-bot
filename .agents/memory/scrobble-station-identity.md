---
name: Scrobble station identity
description: Evidence and authority rules for treating public scrobble accounts as radio station metadata.
---

Public scrobble accounts are actor-controlled observations, not station metadata. Keep station first-party feeds and ICY authoritative. A matching handle or occasional aligned track is not identity evidence.

**Why:** Last.fm requires an API key but provides no account-ownership attestation or reliable current-track start timestamp. Rocksky's public actor history is listener activity, while its expiring status record is optional and was absent across tested public and self-hosted PDS actors. Valid account data can therefore be falsely attributed to a station.

**How to apply:** Keep scrobble probes non-writing. Require a station-controlled link or confirmation, or a pre-registered multi-hour comparison with repeated transition agreement and no contamination, before even considering a station-specific corroboration source. Never let scrobbles outrank first-party/ICY evidence.