---
name: Radio catalog paging and evidence cost
description: Performance and honesty rules for Lore's integrated radio browse catalog.
---

Serve the radio catalog as stable server-backed pages, and keep the server’s eligible total separate from the current four-station presentation page. Do not make the client download the complete catalog before rendering the first deck.

**Why:** Eagerly loading the full eligible set delayed the first deck, while an unfiltered catalog query became very slow because it calculated latest-track age and liveness for every station even when the selected lens and sort did not use that evidence.

**How to apply:** Apply all eligibility families before server pagination. Only join operational playback rows for the returned station slugs. Skip current-track and liveness SQL unless a Playing now filter or Live now sort requires it.