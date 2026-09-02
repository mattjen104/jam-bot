---
name: Apple jam room protocol
description: Durable privacy, revision, and clock rules for Apple Music group rooms.
---

Apple Music jam state is a server-authoritative, monotonically revised snapshot with an append-only event at the same revision. The snapshot update and event insert must commit in one transaction; terminal expiry is also an event and must reach already-connected SSE clients.

**Why:** A committed snapshot without its matching event silently diverges connected listeners, while request-only expiry leaves a quiet room playing beyond its lifetime. Apple Music credentials are a separate concern and must never be included in the shared protocol.

**How to apply:** Use the short room code as the private join capability, authorize host mutations against the Lore session, keep MusicKit user tokens exclusively in each browser, and apply same-track anchors only when drift crosses the correction threshold.