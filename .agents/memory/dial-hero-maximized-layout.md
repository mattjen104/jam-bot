---
name: Dial hero maximized layout
description: Front-door layout model — album hero IS the Radio tab content; landscape rules and their scoping gotchas.
---

The Radio front door has no section heading and no Recent tab: the avatar album hero is the tab content itself (user decision — sort is already opinionated; time-travel/scrub replaced Recent).

Layout model:
- Portrait: full-width square art in flow under the topbar; dial rows scroll below; slim toolbar (sort ▲/▼ + ＋Artists) right-aligned under the art.
- Landscape phones (`orientation: landscape` + `max-height: 540px`): art is `position: fixed` left at `100dvh - var(--shell-h)` height; content shifts right via `padding-left` on `.dial-root--front` ONLY — drill levels (station/show/DJ) render no art panel, so unscoped padding leaves a phantom left gap.
- Landscape also collapses the bottom nav record sleeves to a slim label bar app-wide; `--shell-h` is measured live (ResizeObserver in App.tsx), so the hero auto-expands — never hardcode the shell height.

**Why:** maximize album size per orientation; thumbs sit at the sides in landscape grip.

Gotchas:
- `avatarUrl` is never falsy (RUMOURS local fallback) — guards on it are dead code.
- The fullscreen overlay img is `width: 100vw`; landscape needs a height-fit override or it crops.
- App-preview screenshots can race the hero image load and show a black square — re-shoot before diagnosing.
