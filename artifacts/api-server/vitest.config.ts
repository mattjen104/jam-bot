import { defineConfig } from "vitest/config";

export default defineConfig({
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
    // 30 s per test — DB integration tests can take several seconds each.
    // The 5 s default caused spurious timeouts on overlaps/crossings/player
    // requests that had to wait for a connection under parallel load.
    testTimeout: 30_000,
    // 90 s for beforeAll/afterAll — the default 10 s flakes under contention:
    // hooks that open a DB connection time out when the dev api-server
    // pollers and the DB suite load Postgres during validation runs.
    hookTimeout: 90_000,
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
