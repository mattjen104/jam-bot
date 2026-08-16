---
name: Test-seam fakes drift from the real return shape
description: A _testOnly seam fake that returns the wrong shape produces silent false negatives, not errors — check the fake's contract before blaming the route.
---

**Rule:** When a `_testOnly_set...` seam swaps in a fake, the fake must return exactly the real function's result shape. If the real function's return type later gains a wrapper (e.g. `AcrMatch` → `{ match, clipEndedAt }`), every fake that still returns the old shape makes callers destructure `undefined` — which often flows into a legitimate "no result" branch and yields a clean, error-free wrong answer (`logged: false`, empty list, etc.), not a crash.

**Why:** The fingerprint DB test failed with `expected body.logged true, got false` and zero errors anywhere. The route ran fine: `const { match } = result` gave `match === undefined` because the fake runner returned the bare match instead of the `FingerprintResult` wrapper, and `if (!match)` is the honest no-match path. Isolated probes of the underlying persist path all passed, which pointed away from the route logic and toward the seam.

**How to apply:** When a seam-faked route test fails with a "clean" wrong value (no thrown error, no console.error), diff the fake's return value against the real function's current return type FIRST — before instrumenting the route or suspecting DB/dedup logic. Typing the fake as `typeof realFn` in the test would catch this at compile time; prefer that when writing new seams.
