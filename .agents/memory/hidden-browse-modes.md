---
name: Hidden browse modes (sleep / era-genre)
description: Durable policy decisions behind Lore's hidden station browse modes — flag semantics, precedence, and boot-order pitfalls.
---

# Hidden browse modes (sleep / era-genre)

- Mode flag ≠ hidden. `hidden=true` means soft-hide **and poller stop**, so any
  mode station that must keep ingesting spins (the FIP thematic sub-channels
  ingest for crossing history) stays `hidden=false` with only the mode flag set;
  mode endpoints filter on the mode flag, not `hidden`.
  **Why:** an early revision hid the FIP sub-channels, which would have silently
  frozen their spin ingestion at the next boot.
- Precedence is sleep > permanent blocklist > era/genre, and it must hold at
  **every** classification layer, not just the helper. Boot ordering matters:
  the era/genre migration runs before the blocklist hide migration, so relying
  on "already hidden ⇒ skip" is not enough — a still-visible blocklisted name
  with a genre keyword ("Lofi Hip Hop Radio", "…LOUNGE") gets era-flagged first,
  then leaks through the mode endpoint. Any classifier that runs earlier in boot
  must explicitly exclude the later policy's full pattern set (shared constant),
  and idempotent migrations should include a self-heal step for rows a previous
  revision misclassified.
- Ingest may only force `hidden=true` for genuine `source='radio_browser'` rows;
  curated/seeded rows sharing a slug keep their hidden flag owned by seed/
  migration policy, or re-discovery clobbers deliberate settings.
- Word-boundary matching (JS helper + Postgres `\y`) is mandatory for name
  patterns — substring matching classifies "Experimentalgems" via "gems",
  "Alaska" via "ska".
- Sibling localStorage mode stores need **synchronous** mutual exclusion; a
  dynamic `import()` in the setter is an async race. Register a callback into
  the older module at import time instead.
- New `stations` columns must also be applied in the api-server test
  globalSetup, and new classification patterns can capture pre-existing test
  fixture names.
