---
name: Fleet poller liveness
description: Durable rules for distinguishing a healthy scheduler from a fleet whose station work has stopped progressing.
---

Fleet health requires two independent signals: an owner-guarded process heartbeat and completion progress across the authoritative enrolled roster. Every polling tier, including shared-host multiplexers and persistent sockets, must report attempts and completions. Repeated unchanged metadata is a successful source observation even though spin ingestion remains change-only.

**Why:** A timer can keep writing fresh heartbeats while station fetches are hung, and routing tiers that bypass interval polling can otherwise prevent a real fleet cycle from ever completing or create false stalls. Owner guards also prevent an old process from overwriting a replacement during rolling restarts.

**How to apply:** When adding or changing a polling tier, wire its transport-level success and failure paths into fleet accounting, preserve roster membership during routing transitions, and keep ingestion dedup separate from liveness observations.