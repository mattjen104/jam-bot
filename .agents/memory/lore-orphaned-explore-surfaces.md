---
name: Lore orphaned Explore surfaces
description: Some Explore-looking components have no host page; always grep for importers before treating a front-door component as live.
---

Some Lore components that look like the live front door are orphaned — no
route or view imports them. The live Explore surface is the `/feed` Dial
composition, not the components that merely name it.

**Why:** a task touching Explore nearly edited dead components; only grep for
importers revealed there was no host. Names and file paths are deliberately
omitted here — re-grep, since the set of orphaned files changes over time.

**How to apply:** before changing any "Explore"/"front door" component, grep
the codebase for its importers to confirm a page actually renders it. Also:
the first-plays history endpoint only serves its public, non-personalized home
fast lane for an exact request shape (home flag + fixed limit) — match the
existing home rail's request exactly rather than choosing a new limit.
