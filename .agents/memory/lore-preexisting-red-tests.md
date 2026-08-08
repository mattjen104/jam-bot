---
name: Pre-existing red lore tests
description: Some lore vitest/e2e failures exist on master; git-stash-compare before blaming your diff.
---
The rule: when the lore suite or e2e gate fails after your change, `git stash -u`, rerun the failing file, `git stash pop` — several failures are red on master (as of Aug 2026: dialTimeTravelStrip (g)/(h) run-landing, dialZoneTruncation + mobileFrontDoor "no dial-topbar--all" assertions).

**Why:** these regressions predate individual tasks; chasing them inside an unrelated task wastes hours and inflates scope.

**How to apply:** stash-compare any failure you didn't obviously cause; only fix ones your diff introduced. A dedicated task exists for catching broken dial/player tests in merge checks.
