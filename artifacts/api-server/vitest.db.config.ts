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
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // 1 worker: eliminates inter-file contention on the shared Postgres instance.
    // At 2 workers the DB-test suite intermittently races the running API Server
    // workflow's background pollers (radio-browser discovery, ICY watchers) and
    // fails tests that pass in isolation (now-playing-cold-start, station-curation
    // purge, support-holds).  Sequential execution removes that variable entirely
    // while still exercising the same code paths.
    maxWorkers: 1,
    minWorkers: 1,
  },
});
