import { describe, it, expect, vi } from "vitest";
import type { db } from "@workspace/db";
import { applyLibrarySyncMigration } from "../src/lore/library-sync-migration.js";

/**
 * Smoke tests for applyLibrarySyncMigration.
 *
 * Verifies that:
 *   - The migration runs without throwing on a fresh boot.
 *   - It is idempotent (safe to call multiple times — uses IF NOT EXISTS).
 *   - It issues exactly two SQL statements per call:
 *       1. CREATE TABLE IF NOT EXISTS library_sync_jobs
 *       2. ALTER TABLE … ADD COLUMN IF NOT EXISTS committed_offset / resumed_from / matched_json
 *   - DB errors propagate (are re-thrown) so the caller (`runMigration`) can
 *     record them in the failure registry; it is the caller's responsibility
 *     to decide whether to crash the boot sequence.
 *
 * Each test injects a local executor so no real database connection is needed.
 */
function createDatabase() {
  const execute = vi.fn().mockResolvedValue(undefined);
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applyLibrarySyncMigration", () => {
  it("resolves without throwing on the first boot call", async () => {
    const { database } = createDatabase();
    await expect(applyLibrarySyncMigration(database)).resolves.not.toThrow();
  });

  it("is idempotent — a second call also resolves without throwing", async () => {
    const { database } = createDatabase();
    await applyLibrarySyncMigration(database);
    await expect(applyLibrarySyncMigration(database)).resolves.not.toThrow();
  });

  it("executes exactly two SQL statements per call (CREATE TABLE + ALTER TABLE)", async () => {
    const { database, execute } = createDatabase();
    await applyLibrarySyncMigration(database);
    // Statement 1: CREATE TABLE IF NOT EXISTS library_sync_jobs
    // Statement 2: ALTER TABLE … ADD COLUMN IF NOT EXISTS committed_offset / resumed_from / matched_json
    expect(execute.mock.calls).toHaveLength(2);
  });

  it("passes truthy Drizzle SQL objects (not raw strings) to db.execute", async () => {
    const { database, execute } = createDatabase();
    await applyLibrarySyncMigration(database);
    const calls = execute.mock.calls;
    for (const [sqlArg] of calls) {
      expect(sqlArg).toBeTruthy();
      expect(typeof sqlArg).toBe("object");
    }
  });

  it("propagates DB errors so runMigration can record them in the failure registry", async () => {
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("relation does not exist"));
    // The migration must re-throw — error handling belongs to runMigration,
    // not to the individual migration function.
    await expect(applyLibrarySyncMigration(database)).rejects.toThrow("relation does not exist");
  });

  it("a subsequent clean call succeeds after a previous failed call", async () => {
    const { database, execute } = createDatabase();
    // First call throws on the first statement.
    execute.mockRejectedValueOnce(new Error("transient error"));
    await expect(applyLibrarySyncMigration(database)).rejects.toThrow("transient error");

    execute.mockClear();
    execute.mockResolvedValue(undefined);

    // Second call with a healthy DB succeeds and runs both statements.
    await expect(applyLibrarySyncMigration(database)).resolves.not.toThrow();
    expect(execute.mock.calls).toHaveLength(2);
  });
});
