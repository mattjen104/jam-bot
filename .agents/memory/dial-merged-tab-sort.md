---
name: Merged dial tab & invertible sort
description: ON AIR × YOUR ARTISTS now contains the former Also On Air bands; triangle semantics and sentence copy rules.
---

The Also On Air tab is gone — its DJ band + rest band render inside the ON AIR × YOUR ARTISTS tab.

**Triangle (▲/▼) semantics — user-confirmed decision:**
- ▲ (default): crossing rows in attribution-ladder order, then DJ band, then rest band (popular-heavy first).
- ▼ (flipped): NOT a plain key inversion — it is a discovery ranking. Rest band first (rarest-artist-first via rareVector lexicographic compare), then DJ band, then crossing rows exactly reversed (`zone1Display`).
**Why:** a strict inverse is a wall of zero-crossing noise; the user wants the flipped view to surface "the DJ playing the most obscure set on the dial."

**Sentence copy rules (user-specified, enforced in dialViewHelpers):**
- Oxford commas for 3+ names everywhere (incl. ", and N more").
- "now" always takes a preceding comma: "…, and X, now." ("this set" stays comma-free).
- The word "and" in a crossing sentence is a toggle appending a second informal sentence: " Also, A, B, and C." — the rest of the station's set in setlist order, library artists and already-named artists excluded, with the setlist line's lime/canary classes and "+" adders. Clicks must stopPropagation (row root is a tune-in button).

**How to apply:** any change to sentence builders or dial ordering must preserve these; scan.samplingIdx indexes withReason, so flipped-sort rendering must convert to display index (`length - 1 - idx`).

Note: `artifacts/lore/test/dialCrossingSentence.test.tsx` has 33 pre-existing failures on master (stale copy expectations) — diff pass lists before blaming new changes.
