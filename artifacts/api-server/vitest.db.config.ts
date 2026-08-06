import { defineConfig } from "vitest/config";

// DB-backed suite config — used by the `server-db-tests` validation step.
// Runs ONLY the `*-db.test.ts` files that the fast `server-tests` step
// excludes.  These tests hit the real shared Postgres instance, so worker
// count is capped even lower than the main config to keep connection
// pressure and lock contention down.
export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*-db.test.ts"],
    // Heavy aggregation endpoints (overlaps/crossings run 1M-row scans) can
    // take 10s+ each under concurrent load; a 30s budget flakes on contention.
    // now-playing multi-station scans all active stations → can reach 90s+;
    // those tests override inline to 150s.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // 2 workers, not 4: at 4 the heavy-query files (me-overlaps, me-crossings,
    // now-playing-first-spin, import-worker) time out on shared-Postgres
    // contention; at 2 they pass consistently.
    maxWorkers: 2,
    minWorkers: 1,
  },
});
