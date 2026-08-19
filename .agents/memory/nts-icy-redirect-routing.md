---
name: NTS ICY redirect routing
description: External NTS stream-routing behavior relevant to live metadata verification.
---

NTS 1 and NTS 2 stream relays reach the regional RadioMast audio edge through
two redirect hops before the ICY socket can receive metadata. A successful ICY
probe may legitimately return an empty `StreamTitle` during a metadata interval
between tracks.

**Why:** Treating that empty instant as a broken stream, or assuming a single
redirect reaches the audio edge, falsely makes the NTS track feed look
unavailable.

**How to apply:** Verify the ICY headers and redirect chain independently of a
single sampled title; retain the prior now-playing value until a later
metadata-bearing interval arrives.