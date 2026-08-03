---
name: Support ladder identity grounding
description: Durable identity rules for grounded commerce/support links.
---

The support ladder may expose a release MBID or release-group MBID only when
the provider fact itself supplies that identity. A recording-to-release-group
bridge is not evidence of a particular release, so it must not be used to
populate `releaseMbid` or to synthesize a provider URL.

**Why:** A recording can appear on many releases, reissues, compilations, and
pressings. Treating a release-group identity as a release identity creates
false commerce attribution.

**How to apply:** Keep provider resolution facts release-aware; if only a
release group is known, expose only that group identity or omit the row until a
durable provider URL and supporting fact exist.