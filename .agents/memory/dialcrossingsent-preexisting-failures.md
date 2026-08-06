---
name: dialCrossingSentence pre-existing test failures
description: 33 of 71 tests in dialCrossingSentence.test.tsx fail on master — pre-dates the past-mode work; not a regression introduced by any recent session.
---

## Rule

When running `test/dialCrossingSentence.test.tsx` and seeing ~33 failures, do **not** treat them as a regression from your current change. They are pre-existing.

**Why:** The test expectations were written against an old grammar ("Portishead on air.", "Tom Schnabel — Portishead on air.") that used a dash-separator and "on air" timing. The current `buildAttributedSentence()` uses "selected" phrasing and "this set" timing. The tests were never updated when the grammar changed.

**How to apply:**

1. Run `git stash && vitest run test/dialCrossingSentence.test.tsx` to confirm failures also exist on the pre-change state.
2. If you're updating the test file for a different reason, fix the 33 expectations at the same time.
3. The 38 passing tests (reason(), usableShowName(), nameNodes()) are reliable — only the crossingSentence sentence-form assertions are stale.
