---
name: Lore-wide room audience
description: Product decision and safety boundary for the proposed Lore Remote conversation room.
---

The first sendable Lore conversation room is one site-wide feed for all Lore listeners, not an invite-only club. It is distinct from the existing private Apple Music playback rooms. Visual prototypes may show a non-sendable room while public-posting safeguards are built.

**Why:** The user explicitly chose “All Lore listeners” as the audience. A disposable device cookie is sufficient for personal Library state but not for enforcing public chat moderation after a cookie reset; an invitation gate would contradict the desired product direction.

**How to apply:** Keep public read access and an equal path to posting for every listener, with durable actor identity and moderation before Send is enabled. Do not migrate Slack Jam Bot identity/history into the room or expose private keeps by default. See the behavior proposal in `docs/lore-remote-behavior-room.md` for the current detailed rules.