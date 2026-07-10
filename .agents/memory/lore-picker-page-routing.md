---
name: Lore picker/selector page consolidation
description: Why a "new picker page" can silently never render in Lore, and where curated-picker UI actually lives.
---

`SelectorArchive.tsx` is the single live route for BOTH DJ selectors and curated-list pickers (labels, blogs, curators, etc.) — it branches internally on `data.picker.pickerType === "dj"`. All links (`Selectors.tsx`, `Following.tsx`, `FollowingStrip.tsx`, `Journal.tsx`) point at `/archive/selectors/:handle`.

`/archive/pickers/:handle` is a **legacy redirect** straight to `/archive/selectors/:handle` in `App.tsx` — it never mounts a component of its own.

**Why:** an earlier standalone `PickerArchive.tsx` page was built and wired with its own hooks/UI but never routed anywhere (the legacy redirect pre-empts that path), so it silently rendered nothing in production despite working code and a passing typecheck — no error, no crash, just dead code. A curl of the API endpoint looked fine, which made the bug easy to miss without an actual screenshot of the live route.

**How to apply:** when adding a new per-entity page/feature in Lore, always check `App.tsx`'s route table for the actual live path before building a new page component — grep for how existing UI *links to* that entity (not just what pages exist under `src/pages/`). Add new per-type behavior (e.g. a new insights query) as a branch inside the already-routed page, not a new sibling page. Verify with a screenshot of the real navigated route, not just an API curl.
