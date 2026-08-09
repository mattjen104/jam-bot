---
name: Station context as sidebar tab
description: How the dial's tuned-station context is folded into the set-panel tab strip, and its layout gating rules.
---

The tuned station context (breadcrumb + summary row + rail) renders as a tab in the set-panel sidebar, not a separate region — but ONLY in the landscape/sidebar layout.

**Rules:**
- Single context tab with a fixed id (`CONTEXT_TAB_ID`); scope kind `"context"` carries the station slug. `scopedSets` returns `[]` for it; `TabbedSetPanel` renders `contextBody` instead of set affordances when it's active.
- Entering context mode opens/focuses the tab via an effect keyed on `(sidebarLayout, inContext, ctxSlug)`; leaving context removes it. Closing the tab calls `surface.dial()` + `pastScan.reset()` and lets that effect remove the tab (never remove it directly in the close handler, or the surface and the tab strip drift).
- Portrait keeps the old in-body `DialContextRegion` with the consolidation rule (rail suppressed while a set panel is open). In the sidebar tab the rail ALWAYS renders — only one tab is visible at a time so it never duplicates the queue.

**Why:** one sidebar total on desktop; mobile quiet tuned view must not regress.

**How to apply:** gate any similar relocation on `window.matchMedia("(orientation: landscape)")` — matching the CSS that positions the sidebar — and guard `typeof window.matchMedia === "function"` (jsdom lacks it; ~130 unit tests crash otherwise). E2E flows that tune in landscape must click the queue tab (label contains "·") before asserting `.set-queue__artist`, since the context tab takes focus on tune.
