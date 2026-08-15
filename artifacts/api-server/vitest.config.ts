import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "../../.cache/vitest/api-server",
  test: {
    environment: "node",
    // globalSetup runs once in the main thread before any worker starts.
    // It applies the idempotent DDL migrations (selector_claims,
    // spotify_library_items) exactly once, eliminating the lock-contention
    // spike that occurred when all 86 workers fired CREATE TABLE IF NOT EXISTS
    // simultaneously in their per-file beforeAll hooks.
    globalSetup: ["./test/globalSetup.ts"],
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    bail: 1,
    // 30 s per test — DB integration tests can take several seconds each.
    // The 5 s default caused spurious timeouts on overlaps/crossings/player
    // requests that had to wait for a connection under parallel load.
    // Raised from 30s: the merge gate runs this suite concurrently with the
    // lore vitest + e2e gates, and under that saturation DB-backed tests here
    // randomly exceeded 30s (different files each run; all pass in isolation).
    testTimeout: 120_000,
    // 90 s for beforeAll/afterAll — the default 10 s flakes under contention:
    // hooks that open a DB connection time out when the dev api-server
    // pollers and the DB suite load Postgres during validation runs.
    // Raised from 90s for the same merge-gate saturation reason as above.
    hookTimeout: 180_000,
    // Cap concurrent workers so the shared Postgres instance is not
    // overwhelmed by connection-pool exhaustion.  lib/db creates a pg.Pool
    // per worker with a default max of 10 connections; 4 workers × 10 = 40
    // connections, well within Postgres's max_connections.
    // Without this cap, vitest may spin up many more workers, causing both
    // connection exhaustion and enough per-query latency that slow tests
    // (e.g. spin-dedup-cleanup) tip over their explicit 30 s budgets.
    maxWorkers: 4,
    minWorkers: 1,
  },
});
