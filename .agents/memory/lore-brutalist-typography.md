---
name: Lore brutalist typography block
description: End-of-index.css uniform-size !important block controls all Lore font sizes; per-rule sizes are inert.
---

Lore's index.css ends with a "BRUTALIST TYPOGRAPHY" block: `body, body * { font-family + font-size !important }` (single uniform size, wordmark exception). It wins the cascade over every per-rule, Tailwind, and inline font-size.

**Why:** deliberate one-face-one-size design decision; later "change font size" requests must edit THIS block — scaling the hundreds of per-rule sizes does nothing visible.

The theme is also fully grayscale (user decision): no saturated color anywhere, including Tailwind hue utilities (use zinc). Semantic meanings survive as a lightness ramp — accent/keep ~90%, selector-dj 82%, library 75%, selector-show 64%, live 62%, selector-station 46%. Brand recedes: big black wordmark with thin white text-stroke.

**How to apply:** to resize type app-wide, bump the uniform size (and the wordmark exception proportionally). Also: no-bold/no-italic policy is enforced there too; watch fixed-height compact controls (use min-height, not height) when bumping. Inline React `fontStyle` must be "normal", never a Tailwind class name.
