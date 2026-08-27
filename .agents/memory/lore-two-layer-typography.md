---
name: Lore two-layer typography
description: Voice (Signifier) vs interface (system sans) split and the three-step size scale in tokens/typography.css
---

Rule: all font sizes in the lore classic UI come from three tokens in `src/tokens/typography.css` — `--lore-size-signature` (23px), `--lore-size-interface` (16px), `--lore-size-small` (12px). Never write a px font-size or name Signifier outside that file, except the pinned voice-surface block near the end of index.css.

Voice layer (Signifier via `--lore-font-signature` / `--lore-font-wordmark`): wordmark, dial sentence-grammar rows (`.fdrow__t1`, pop/overlap/crail sentences), `.reading-context` editorial surfaces (`--lore-font-editorial` also resolves to Signifier — Newsreader is NOT loaded). Everything else is the native system sans via `--lore-font-body/display/mono` (all three aliases resolve to the same sans stack; role names kept for legacy callsites). The home front door is the deliberate exception: its complete surface uses Nebula Sans, with Semibold reserved for headings.

Home typography rule: keep Nebula Sans scoped to the front door; use its 600 weight for the intro and section headings (`Now Playing`, `Selected New Releases`, and `Library`), while supporting labels and metadata use lighter weights.

**Why:** the home interface was intentionally changed from a mixed terminal/editorial treatment to one readable, unified sans surface, and the user specifically chose Semibold headings for hierarchy.

**How to apply:** scope any future home typography override beneath `.split-home`; do not change the established typography on `/feed`, `/library`, or other Lore routes.

**Why:** the old brutalist `body * { Signifier 23px !important }` decree accumulated ~20 `!important` exceptions and was illegible on phones; the decree also meant every non-!important font-size rule in index.css was dead code — when removing such a block, map old px values to the scale by band (≤13→small, 14–17→interface, ≥18→signature) to preserve rendered output for large text.

**How to apply:** new components use the tokens; front-door density overrides (`.dial-root--front .fdrow__t1`) may step a voice surface down to the interface size but must not change its face.

Pitfall: `.dial-topbar__wordmark` carries a late button-normalisation block with `font: inherit` that silently kills the Signifier pinning for any element reusing that class outside the topbar. Don't reuse the class for static labels — style a scoped class with the tokens directly.

Safari resilience rule: browser-only layout observers must be optional. In particular, the shared bottom shell needs a viewport-resize fallback when `ResizeObserver` is absent, and the Vite target stays at ES2018 so the mobile preview does not depend on a newer Safari syntax baseline.

**Why:** a Safari iPhone preview can otherwise fail before the home route mounts, presenting as a blank white page while Chromium remains healthy.

**How to apply:** feature-detect browser APIs at application mount and preserve a plain event-based fallback; keep the error boundary outside the player/layout tree so a rendering failure becomes visible rather than blank.
