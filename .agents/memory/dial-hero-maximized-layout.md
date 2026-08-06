---
name: Dial hero maximized layout
description: Front-door layout model — album hero IS the Radio tab content; landscape rules and their scoping gotchas.
---

The Radio front door has no section heading and no Recent tab: the avatar album hero is the tab content itself (user decision — sort is already opinionated; time-travel/scrub replaced Recent).

Layout model:
- Portrait: full-width square art in flow under the topbar; dial rows scroll below; slim toolbar (sort ▲/▼ + ＋Artists) right-aligned under the art.
- Landscape (ALL landscape viewports, desktop included — user decision): `.dial-hero__artwrap` is `position: fixed` left at `100dvh - var(--shell-h)` height (capped 52vw); content shifts right via `padding-left` on `.dial-root--front` ONLY — drill levels (station/show/DJ) render no art panel, so unscoped padding leaves a phantom left gap.
- Section nav: the record-sleeve bottom nav (RecordPeekNav) is hidden "for now" (component kept, unmounted; its 7 tests fail on master already). Nav = `SlimSectionNav` (own module, components/SlimSectionNav.tsx): RADIO/SELECTORS/LIBRARY text buttons — overlay variant scrimmed across the top of the art on the front door, bar variant at top of non-home pages via AppLayout.
- `--shell-h` is measured live (ResizeObserver in App.tsx) and now covers only the bottom strip + optional PlayerDock; fallback is 0px — never hardcode the shell height.

**Why:** maximize album size per orientation; thumbs sit at the sides in landscape grip.

Gotchas:
- `avatarUrl` is never falsy (RUMOURS local fallback) — guards on it are dead code.
- The fullscreen overlay img is `width: 100vw`; landscape needs a height-fit override or it crops.
- App-preview screenshots can race the hero image load and show a black square — re-shoot before diagnosing.
