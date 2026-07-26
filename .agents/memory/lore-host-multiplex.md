---
name: Multiplexed now-playing tier (Icecast host poll + AzuraCast SSE)
description: One request/connection covers many stations; probe-once classification; routing rules
---

Middle tier between instant sockets and slow history polling: stations sharing an Icecast host are covered by ONE `/status-json.xsl` poll per host (~10s), and AzuraCast instances by ONE SSE connection (Centrifugo `cf_connect` subs), degrading to the aggregate `/api/nowplaying` poll on persistent SSE failure.

**Rules learned:**
- Host capability is probed once and persisted as `nowPlayingConfig.multiplex: {kind: icecast|azuracast|none, shortcode?}`. Persist via an atomic jsonb merge (`config || '{"multiplex":...}'`), never read-merge-write — concurrent admin config edits get clobbered otherwise.
- All tier routing goes through the poller's single route function (host group → probe → interval); every fallback path (watcher failure, lease demotion, enroll) must use it, or stations silently miss the cheap tier.
- Multiplex hooks must be installed BEFORE any routing/probing at boot; a fast probe completing against default no-op hooks strands a classified station on interval polling.
- The probe-completion reenroll hook must be watcher-aware: skip stations that acquired a pinned/leased watcher while the probe was in flight, or the reenroll tears down live socket coverage.
- Mount identity = URL pathname (host aliases/CDNs vary); AzuraCast station matching = shortcode via listen-URL path match.
- Icecast mounts with no metadata report placeholder title "Unknown" (empty artist) — must be junk-filtered or it logs bogus spins.
