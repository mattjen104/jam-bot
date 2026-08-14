---
name: Split homepage vs full Dial routing
description: The / route is the three-band split view; the full Dial lives at /feed.
---

# Split homepage vs full Dial routing

The Lore front door `/` renders the three-band SplitHome (compact Dial / CLI
strip / compact Stack), not the full DialView. The full scrollable Dial moved
to `/feed`.

**Why:** the split view surfaces radio + library at a glance without
scrolling; the CLI strip is the seam between them.

**How to apply:** anything exercising full-Dial behaviour (infinite scroll,
first-run sidebar, player-dock tune-in helpers, e2e specs) must target
`/feed`, not `/`. CLI commands surfaced on the split home must actually be
wired into its own render path — inheriting a command from DialCliBar does
not make it work there.
