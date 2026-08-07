---
name: Tier-1 prefetch ownership & interstitial gating
description: Durable rules for the Tier-1 link-prefetch/queue-run pipeline and the live→past interstitial gate
---

Rule 1: any effect that refetches queue items keyed on "no links yet" must remember COMPLETED lookups (even zero-link results), or link-less items refetch in a tight loop whenever the downstream consumer is deferred.

Rule 2: per-ride mutable sets must only be mutated after validating the ride token — a stale request settling after a ride replacement must not mark the new ride's identical MBID as done, or the replacement silently skips its lookup and hard-stops.

Rule 3: the live→past interstitial gate must suppress ALL Spotify audio commands — the per-track driver, the alt-driver cascade, AND the Tier-1 bulk queue-run. Tier-1 past replay never issues per-track plays, so tests proving "replay resumes" must assert the bulk queue-run (with seed URIs), not spotifyPlay.

**Why:** gating only some command paths lets Tier-1 start audio during the crossing tone; and the deferred queue-run exposed both the prefetch loop and the stale-settle race.
