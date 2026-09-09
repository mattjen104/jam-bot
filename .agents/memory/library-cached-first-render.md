---
name: Library cached-first render
description: The Library removes repeat-visit blank waits with a narrow, stale-while-refresh device-local snapshot.
---

Persist only the first page for each exact Library query shape (limit, search,
sort, and source), with bounded expiry and structural validation. Use it as
initial UI data but mark it stale immediately so the server refresh always runs.

**Why:** The main Library request is the only first-paint blocker; set contexts
and release metadata are already progressive. Persisting all pages would add
storage and invalidation cost without improving the useful first paint.

**How to apply:** Keep normal infinite pagination after the first cached page.
Every successful first-page response, including an empty one, must replace the
snapshot. Storage failures must never fail the live request.

Crate rows must also mount their fixed-size set deck immediately while
set-context enrichment is pending. Show both chevrons disabled with honest
loading labels, then enable them when neighbors arrive; do not make the art
column change shape as enrichment completes.