---
name: Canadian campus radio ICY fix
description: Why CFUV/CHMR/CISM/CJSR/CKCU/CKUT were moved from spinitron_web to radio_browser_icy and what to watch for.
---

## The fix
All 6 curated Canadian stations (cfuv, chmr, cism, cjsr, ckcu, ckut) were originally configured as `spinitron_web` with their callsigns, but `https://spinitron.com/{CALLSIGN}/` returns 404 for all of them — they are NOT on Spinitron's public web despite being in the embedded `EMBEDDED_SPINITRON_STATIONS` list in seed.ts (lines 1148-1155).

**Resolution**: Switched to `radio_browser_icy` with verified ICY stream URLs and `favorite=true`.

## Why favorite=true is required
Non-favorite `radio_browser_icy` stations go through `routePollingTier` → `tryJoinHostGroup` → Icecast mux → reads status.xsl. The Icecast status.xsl pages for these stations show empty "Currently playing" fields. The mux never produces spins. Only `favorite=true` triggers a persistent ICY watcher socket that reads inline ICY metadata blocks.

## ICY stream state during the fix
All 6 streams confirmed reachable with `icy-metaint: 16000`. All emitted `StreamTitle=''` at fix time (late evening Canada time, talk/automation programming). CKUT produced the first spin shortly after the watcher connected. CJSR's ICY stream includes a cdnstream1.com metadata URL in StreamUrl, confirming its DAS system will populate StreamTitle during music.

**Why**: Confirmed by reading the first ICY metadata block from each stream at `icy-metaint: 16000` byte offset.

**How to apply**: If these stations go silent again, check whether their ICY streams are emitting non-empty StreamTitle before looking for alternative sources. The watcher is the correct approach — the silence was programming-related, not infrastructure.

## Embedded Spinitron list
seed.ts `EMBEDDED_SPINITRON_STATIONS` still lists all 6 with callsigns as if they were on Spinitron. The seed uses `onConflictDoNothing` so it won't overwrite the DB fix, but the list is misleading for future maintenance.

## Stream URLs
- CFUV: `http://ais-sa1.streamon.fm/7132_64k.aac` (DAS resolved, cfuv.streamon.fm redirects here; ICY watcher cannot follow redirects)
- CHMR: `http://192.99.14.49:9005/live128` (Icecast 2.4.4)
- CISM: `http://stream03.ustream.ca/cism128.mp3` (Icecast 2.4.4)
- CJSR: `http://ais-sa1.streamon.fm/7093_24k.aac` (DAS resolved, cjsr.streamon.fm redirects here)
- CKCU: `https://stream2.statsradio.com:8124/stream` (Icecast 2.4.0-kh15)
- CKUT: `https://ckut.out.airtime.pro/ckut_a` (Icecast 2.4.0-kh15 via Airtime)
