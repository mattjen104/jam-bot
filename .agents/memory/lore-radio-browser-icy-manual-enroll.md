---
name: Manual radio_browser_icy station enrollment
description: How to add a station to Lore's ICY-poll rotation directly via DB when the admin enroll endpoint is unavailable, and the pitfalls that make it silently never poll.
---

When enrolling a `radio_browser_icy` station by inserting directly into `stations` +
`radio_browser_stations` (bypassing the `/api/admin/radio-browser/enroll` endpoint,
e.g. because `LORE_ADMIN_TOKEN` isn't set), two things are easy to get wrong and both
fail *silently* (no error logs, station just never produces spins):

1. **`now_playing_config` must include `streamUrl`**, not just `radioBrowserId`. The
   `radio_browser_icy` adapter reads `config.streamUrl` — it does NOT fall back to the
   `stations.stream_url` column. A config of `{radioBrowserId: N}` alone means every
   poll returns null immediately with zero errors logged.
2. **New stations always inherit `source: 'radio_browser'`**, which puts them in scope
   for the periodic whitelist purge (`purgeNonQualifyingStations`, requires
   votes >= MIN_VOTES=100, bitrate >= 128kbps, tag whitelist match). A manually-inserted
   row has votes=0/no tags and gets deleted on the next purge cycle unless you set
   `source: 'curated'` instead (the pattern already used for hand-picked NTS stations).

**Why:** both failure modes look identical to "station just isn't playing anything
right now" — nothing errors, nothing logs — so they're easy to ship without noticing.

**How to apply:** when hand-inserting, always set `now_playing_config = {streamUrl,
radioBrowserId}` and `source = 'curated'`. Also note the boot poller staggers ticks
by flat array index across ALL stations (`STAGGER_MS=4000` per station), so a station
appended at the end of a 600+ row table can wait tens of minutes after a restart
before its first real poll — validate the adapter directly (`fetchIcyMetadata`/
`getNowPlayingAdapter` against the exact stored config) instead of waiting on the
live poller to prove a stream works.

Also: the raw-TCP ICY fetcher (`icy.ts`) does not follow HTTP redirects — any stream
behind a 302 (Live365, Radiojar, some CDN mirrors) reports `icy_unsupported` even
though the resolved URL works fine. Resolve the redirect once (e.g. `fetch(url,
{redirect:"follow"})`) and store the final URL instead, but note some redirectors
(Radiojar) mint a new token per request, so resolving once may still go stale.
