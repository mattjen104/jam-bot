---
name: Fleet poller liveness
description: Durable rules for distinguishing a healthy scheduler from a fleet whose station work has stopped progressing.
---

Fleet health requires two independent signals: an owner-guarded process heartbeat and completion progress across the authoritative enrolled roster. Every polling tier, including shared-host multiplexers and persistent sockets, must report attempts and completions. Repeated unchanged metadata is a successful source observation even though spin ingestion remains change-only.

Roster changes must be persisted immediately instead of waiting for the periodic timer. In heartbeat SQL that conditionally inserts an alert, explicitly cast nullable bound values used only in `IS NOT NULL` predicates; PostgreSQL cannot infer the type of a bare `NULL` parameter and will abort the entire heartbeat statement.

**Why:** A timer can keep writing fresh heartbeats while station fetches are hung, and routing tiers that bypass interval polling can otherwise prevent a real fleet cycle from ever completing or create false stalls. A failed optional-alert CTE can roll back an otherwise valid health update, making active ingestion look dead. Owner guards also prevent an old process from overwriting a replacement during rolling restarts.

**How to apply:** When adding or changing a polling tier, wire its transport-level success and failure paths into fleet accounting, persist enrollment mutations promptly, preserve roster membership during routing transitions, and keep ingestion dedup separate from liveness observations. Exercise no-alert and alert transitions against real PostgreSQL, not only mocked `db.execute`.