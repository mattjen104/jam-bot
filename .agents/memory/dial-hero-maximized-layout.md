---
name: Dial full-height layout & spine strip
description: Front-door layout model after the album-art hero was removed — full-height feed, decorative spine strip, CLI overlay offsets.
---

The Radio front door no longer has an album-art hero (removed by user decision): the dial feed is full-height in every orientation, and the only artwork on the front door is a decorative 5-pane "spine strip" of the newest kept-track covers.

Layout model:
- Spine strip (`.dial-spine-strip`): landscape-only, `position: fixed` at left:0, width `--spine-strip-w` (32px default), top:0 → bottom `--shell-h`. Hidden entirely in portrait (`display:none`). Purely decorative — `aria-hidden`, `pointer-events:none`, no labels/roles. Null artwork URLs render as dark fallback panes that blend with the background (correct for signed-out users, not a bug).
- Artwork source: newest 5 kept library tracks via the library API `source=keep` (hook preserves nulls so fallback slots keep their position).
- Front door only: `.dial-root--front .dial-body` gets `padding-left: var(--spine-strip-w)` so feed text doesn't underlap. Drill levels (station/show/DJ) render no strip and must not inherit the padding.
- CLI overlay (`.dial-cli-overlay`): `position:fixed`, top 56px (below app header), bottom `--shell-h`; landscape starts at `left: var(--spine-strip-w)`; wordmark is bottom-LEFT anchored (opposite the right-justified artist names), `mix-blend-mode: screen`.
- `--shell-h` is measured live (ResizeObserver in App.tsx), fallback 0px — never hardcode.

**Why:** the feed IS the front door; art was demoted to ambient texture at the edge.

Gotchas:
- The old avatar/hero probing pipeline (RUMOURS fallback, hi-res iTunes/CAA probing, fullscreen overlay) is deleted from DialView — don't resurrect guards or comments referencing it.
- The strip's z-index (4) must stay above the CLI overlay (3) so panes cover the wordmark's left edge.
- App-preview screenshots of a signed-out session show no visible spine (all fallback panes) — verify with a session that has kept tracks before diagnosing.
