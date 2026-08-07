---
name: lore-tests merge gate
description: The lore vitest suite is now a registered validation step; how to run it and keep it green.
---
The rule: `lore-tests` validation workflow (`flock /tmp/lore-vitest.lock pnpm --filter @workspace/lore exec vitest run`) gates merges alongside server-tests/typecheck. Keep it green — do not let UI copy/grammar changes land without updating tests.

**Why:** the suite sat red for weeks (19 files / 180 tests) because nothing ran it pre-merge; failures were almost all stale copy/structure drift (removed zone collapse + count badges, time-travel strip replaced by hero-art chevrons, DialView/PlayerProvider now need QueryClientProvider or useAppConfig barrel mocks).

**How to apply:** after changing lore UI copy or component structure, run the lore-tests validation before merging. Always use the flock wrapper — parallel vitest runs in this package collide otherwise.
