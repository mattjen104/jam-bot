---
name: History-tier cadence & coverage classes
description: Why history sources poll every 10-15 min safely, boundary-bias scheduler rules, coverage classification
---

History-paging sources (Spinitron, KEXP, BBC, SomaFM) page back to a per-station cursor, so relaxed 10–15 min polling loses nothing — spins are learned late, never missed. kcrw and spinitron_web look like history sources but serve only the current track/playlist scrape: they have NO history depth and must keep song-length cadence. Per-source override: `LORE_POLL_MS_<SOURCE>` env var.

**Boundary-bias scheduler:** one extra poll per show-tied station shortly after each :00/:30 (+2 min). Lessons:
- A perpetual self-rescheduling scheduler must own its handles directly (single timer ref + fan-out array reset each tick). Pushing recurring handles into the global `timers`/`stationTimers` arrays leaks — those retain fired one-shots forever.
- Guard re-arm with an active flag checked inside `arm()`, or a tick mid-flight during stop re-creates the scheduler after `stopLorePoller`.

**Coverage classes** (`coverageClassFor`): instant (persistent watcher) > multiplexed (host group/SSE membership) > complete-history (deep-paging source) > blind-spot (no history endpoint, no persistent connection — the only tier where between-poll spins are lost forever). Exposed via plain-JSON `GET /admin/stations/coverage`; blind spots surfaced in the Radio Browser admin page with a pin-as-favorite hint.
