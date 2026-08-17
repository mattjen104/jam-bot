---
name: Native checkboxes invisible on dark mobile panels
description: Why filter checkboxes "weren't showing" on mobile and the custom-drawn fix
---

Native `<input type="checkbox">` on mobile Chromium renders ~13px with transparent background and no visible border on a dark card surface — present in the DOM, visible per computed styles, but effectively invisible to the user. accent-color only styles the *checked* state.

**Why:** User reported "no checkboxes on mobile" for the Dial filter dropdowns; DOM/style inspection showed everything "visible", only a real screenshot revealed the near-invisible native control.

**How to apply:** Any checkbox on a dark surface must be custom-drawn: `appearance: none` + explicit border, and a `:checked` state with filled background + data-URI SVG checkmark (CSS vars can't reach into background-image, so hardcode the check color to the card surface). Verify with an actual screenshot, not computed styles.
