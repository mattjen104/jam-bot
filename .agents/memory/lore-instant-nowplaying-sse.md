---
name: Instant now-playing (ICY watchers + SSE)
description: Persistent ICY connections and SSE push channel — design constraints for anyone touching now-playing latency.
---

- Persistent ICY sockets must use the incremental `IcyStreamParser` (count-and-skip audio bytes); the one-shot fetch path Buffer.concats the whole stream and would OOM on a held-open socket.
- **Why:** a stream sends the same StreamTitle ~2/sec; watcher-level dedup keeps `logSpinIfChanged`'s DB reads off the hot path.
- Spin push channel: `spinEvents` in resolve.ts emits `spin-changed` after persistSpin with the already-resolved MBID — clients need no follow-up fetch. SSE route `/stations/now-playing/stream` is deliberately outside openapi.yaml/orval (EventSource, not fetch); do not "fix" that by adding it to the spec, a clean orval run doesn't know about it and that's fine.
- Watchers fall back to interval polling on `persistent-failed` (5 failures/10min or icy_unsupported); enroll/unenroll/stopLorePoller all manage watchers too.
- **How to apply:** boot-time watcher dials must be staggered (~250ms apart) — dialing hundreds of TCP/TLS sockets in one tick causes a connect-timeout storm.
- Frontend: 5s polling intervals in PlayerProvider stay as the correctness backstop; SSE only triggers an immediate tick via trigger refs. Never remove the intervals.
