---
name: Lore two-layer typography
description: Voice (Signifier) vs interface (system sans) split and the three-step size scale in tokens/typography.css
---

Rule: all font sizes in the lore classic UI come from three tokens in `src/tokens/typography.css` — `--lore-size-signature` (23px), `--lore-size-interface` (16px), `--lore-size-small` (12px). Never write a px font-size or name Signifier outside that file, except the pinned voice-surface block near the end of index.css.

Voice layer (Signifier via `--lore-font-signature` / `--lore-font-wordmark`): wordmark, dial sentence-grammar rows (`.fdrow__t1`, pop/overlap/crail sentences), `.reading-context` editorial surfaces (`--lore-font-editorial` also resolves to Signifier — Newsreader is NOT loaded). Everything else is the native system sans via `--lore-font-body/display/mono` (all three aliases resolve to the same sans stack; role names kept for legacy callsites).

**Why:** the old brutalist `body * { Signifier 23px !important }` decree accumulated ~20 `!important` exceptions and was illegible on phones; the decree also meant every non-!important font-size rule in index.css was dead code — when removing such a block, map old px values to the scale by band (≤13→small, 14–17→interface, ≥18→signature) to preserve rendered output for large text.

**How to apply:** new components use the tokens; front-door density overrides (`.dial-root--front .fdrow__t1`) may step a voice surface down to the interface size but must not change its face.

Pitfall: `.dial-topbar__wordmark` carries a late button-normalisation block with `font: inherit` that silently kills the Signifier pinning for any element reusing that class outside the topbar. Don't reuse the class for static labels — style a scoped class with the tokens directly.
