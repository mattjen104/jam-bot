---
name: Crossing-positive filter breaks zero-crossing test fixtures
description: Dial/SplitHome hide zero-crossing stations once crossing scores settle; unrelated tests must pin radioMode or give fixtures crossings
---

The Feed/CompactDial crossing-positive filter (hides stations with zero crossings at the active scope) is ON by default whenever crossings are on. Any vitest/e2e fixture whose stations have no crossings will silently render an empty feed.

**Why:** The filter only applies once crossing scores settle — both SplitHome and DialView suspend it while `crossingsLoading` is true, or the feed blanks transiently on every load (a regression the completion review caught on SplitHome when only DialView had the guard).

**How to apply:** When touching the filter, keep the `crossingsLoading` guard on BOTH surfaces. In tests that are not about crossings, pin `lore:radioMode` (jsdom: localStorage in beforeEach; Playwright: `page.addInitScript`) or pin `lore:crossingScope` to a scope the fixture actually has crossings at — fixtures often carry 24h-level counts but zero show-level counts, and the default scope "set" reads the live show. Note radioMode also changes zone/skeleton rendering, so scope the pin per-test when a spec-wide pin breaks siblings.
