---
name: Positional body.click() in Playwright helpers is layout-fragile
description: e2e helpers that click <body> to blur focus break silently when a DOM reorder puts an interactive control at the body center
---

Playwright's `page.locator("body").click()` clicks the **center** of the body element. In the split-home layout the HomeCliStrip sits at that center, so any strip reorder changes which control the click hits — a chip toggle fired before the test's CLI command, silently corrupting category-filter state (all four dialCategoryFilters CLI tests failed while the code logic was untouched).

**Why:** a pure DOM reorder (no logic change) broke the lore e2e suite gate; the failure mode looked like a filtering regression but was the helper's hidden click.

**How to apply:** to move focus out of an editable before a global-hotkey test, use `page.evaluate(() => document.activeElement?.blur())`, never a positional body click. When an e2e suite fails after a "harmless" UI reorder, suspect the test's implicit position assumptions before suspecting logic. Verify with a `document.elementFromPoint(cx, cy)` probe at the body center.
