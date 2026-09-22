---
name: Merge-gate pre-existing failures
description: Several task-completion validation workflows fail at baseline (Library migration fallout); verify with git stash before assuming your change broke them.
---

The task-completion validation runs the full workflow suite, and as of September 2026 several gates fail on the base tree, independent of any task change:

- `server-tests`: `test/crossing-score.test.ts` ("rejects missing, NaN, and negative cache score fields")
- `server-db-tests`: `test/player-db.test.ts` pool-exhaustion timing assertion (also load-sensitive)
- `lore-tests`: `test/frontDoorRow.test.tsx` live-sentence case expecting a trailing ", now."
- `lore-e2e-suite`: ~24 failures, mostly specs still asserting `/lore/` root after the `/feed` → `/library` Library-migration redirect
- `lore-lint` / `server-lint`: unused-var and control-regex errors in files such as `test/dialContextMode.test.tsx` and `src/routes/me/crossings.ts`
- `api-contract`: 8 `[missing-contract]` entries for `/me/library/albums*`, `/admin/credit-enrichment*`, `/stations/zip-origin`

**Why:** these belong to other in-flight migration work; "fixing" them from an unrelated task risks stomping that work, but they keep the completion gate red.

**How to apply:** when completion validation fails, diff the failing tests against the pre-change baseline (`git stash`, re-run just the failing test, `git stash pop`) and check the session-start workflow states; only fix what your change actually caused, and document the rest in `skip_validation_reason`.

After merged OpenAPI work, a green codegen reproducibility check does not guarantee the live preview is current. Rebuild composite library declarations and restart both Lore and API workflows when the UI imports a new generated hook or depends on a new route.

**Why:** workflow reconciliation can leave an older Vite lock owner or API process alive, while leaf typechecks read stale generated declarations.

**How to apply:** run the root library typecheck before the Lore leaf check, then verify the new route through the shared proxy rather than assuming the restarted frontend implies a restarted API.
