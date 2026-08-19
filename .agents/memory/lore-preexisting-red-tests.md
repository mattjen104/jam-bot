---
name: Pre-existing red lore tests
description: Some lore vitest/e2e failures exist on master; git-stash-compare before blaming your diff.
---
The rule: when the lore suite or e2e gate fails after your change, `git stash -u`, rerun the failing file, `git stash pop` — several failures are red on master (as of Aug 2026: dialTimeTravelStrip (g)/(h) run-landing, dialZoneTruncation + mobileFrontDoor "no dial-topbar--all" assertions).

**Why:** these regressions predate individual tasks; chasing them inside an unrelated task wastes hours and inflates scope.

**How to apply:** stash-compare any failure you didn't obviously cause; only fix ones your diff introduced. A dedicated task exists for catching broken dial/player tests in merge checks.

Update (Aug 2026): the same master regression (`.dial-topbar--all` present + five-fdrow visibility) is red in BOTH `test/dialZoneTruncation.test.tsx` (2) / `test/dialTimeTravelStrip.test.tsx` (3) AND the e2e suite gate's `e2e/mobileFrontDoor.spec.ts` (4). Verify by reverting your diff (git checkout HEAD~1 -- <files>) before blaming it. The tone-e2e gate also flakes when run concurrently with the full vitest suite during completion validation — rerun it in isolation before treating it as real.

Update (Aug 18, 2026): `e2e/compactStackBand.spec.ts` "skip preference survives a page reload" was red on master — `page.reload()` waits for the "load" event which hangs on the dev-server page. Fixed in passing with `page.reload({ waitUntil: "domcontentloaded" })` (the test's own 20s locator wait covers readiness). If other e2e reload tests hang the same way, apply the same waitUntil tweak.
