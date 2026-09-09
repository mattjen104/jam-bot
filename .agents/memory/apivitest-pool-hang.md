---
name: api-server vitest pool hang
description: api-server vitest suites flake exit 1 ("something prevents Vite server from exiting") because test/globalSetup.ts opens pg pools that never close
---

`artifacts/api-server/test/globalSetup.ts` imports `@workspace/db` in the main thread to run migrations/cleanup. The pg Pool's idleTimeoutMillis (10s default) races vitest's close timeout (10s): sometimes the run exits 0, often it prints "close timed out after 10000ms / Tests closed successfully but something prevents Vite server from exiting" and exits 1 **with zero test failures**.

**Why:** an idle pool client keeps the event loop alive; teardownTimeout does NOT help (the handle only closes on its own schedule).

**How to apply:** the globalSetup teardown must `await Promise.allSettled([pool.end(), listenerReadPool.end()])` (both pools from `@workspace/db`). If this symptom resurfaces, diagnose with `vitest run <one file> --reporter=hanging-process` — a single file reproduces it since globalSetup always runs. Also note a lone `pkill -f vitest` from a background shell kills that shell itself when its own command line matches.
