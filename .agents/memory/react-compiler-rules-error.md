---
name: React-compiler hook rules are errors in lore
description: set-state-in-effect/refs/purity/immutability are merge-blocking errors for src/; ref-mirror disables in PlayerProvider are deliberate
---
The four react-hooks compiler rules (set-state-in-effect, refs, purity, immutability) are "error" in artifacts/lore/eslint.config.js for app code; the test/e2e override turns them off (test harnesses use render-phase latest-value ref mirrors by design).

**Why:** the src/ tree was swept to zero violations; keeping them at error blocks regressions at merge time. Note the lint gate runs `eslint .` (tests included), so any rule promotion must account for test/e2e files.

**How to apply:** prefer render-time prev-value resets, useState initializers, and async-callback setState. PlayerProvider keeps documented inline disables for latest-value ref mirrors read synchronously in user-gesture handlers — moving those writes into effects breaks interstitial arming and cast re-arm (tests catch it); don't "clean them up".

Additional patterns that pass the rules (from the SplitHome scan remote): (1) a recursive setTimeout chain inside useCallback cannot reference the useCallback const (`accessed before declared` error) — declare an inner named `function hop()` and recurse on that; (2) latest-value ref mirrors for timer callbacks must be synced in a plain `useEffect(() => { ref.current = value; })`, never during render (`Cannot access refs during render` error) — timers only fire after effects, so the mirror is never stale.
