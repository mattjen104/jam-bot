---
name: Shows lens Bandsintown config
description: Shows lens fetches silently no-op without BANDSINTOWN_APP_ID; settled-empty is by design, not a bug.
---

The Shows Dial lens (taste × Bandsintown events) fails **closed and silent** when the
`BANDSINTOWN_APP_ID` secret is absent: the fetcher no-ops, the route settles with
whatever is stored (initially nothing), and the UI shows the honest "no shows on the
horizon" state. No error is logged anywhere.

**Why:** the lens must degrade safely rather than hardcode an app id or loop on
`computing:true` forever when the upstream is unconfigured.

**How to apply:** if a user reports the Shows lens is always empty, check the secret
first (same failure shape as MATT_LIBRARY_SOURCE_USER_ID). A freshly configured app id
can take one per-user fetch-cooldown window before events appear.
