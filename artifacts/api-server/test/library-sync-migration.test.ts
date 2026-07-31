import { describe, it, expect, vi, beforeEach } from "vitest";
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
 * The mock replaces @workspace/db so no real database connection is needed.
 */

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe("applyLibrarySyncMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves without throwing on the first boot call", async () => {
    await expect(applyLibrarySyncMigration()).resolves.not.toThrow();
  });

  it("is idempotent — a second call also resolves without throwing", async () => {
    await applyLibrarySyncMigration();
    await expect(applyLibrarySyncMigration()).resolves.not.toThrow();
  });

  it("executes exactly two SQL statements per call (CREATE TABLE + ALTER TABLE)", async () => {
    await applyLibrarySyncMigration();
    const { db } = await import("@workspace/db");
    // Statement 1: CREATE TABLE IF NOT EXISTS library_sync_jobs
    // Statement 2: ALTER TABLE … ADD COLUMN IF NOT EXISTS committed_offset / resumed_from / matched_json
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("passes truthy Drizzle SQL objects (not raw strings) to db.execute", async () => {
    await applyLibrarySyncMigration();
    const { db } = await import("@workspace/db");
    const calls = (db.execute as ReturnType<typeof vi.fn>).mock.calls;
    for (const [sqlArg] of calls) {
      expect(sqlArg).toBeTruthy();
      expect(typeof sqlArg).toBe("object");
    }
  });

  it("propagates DB errors so runMigration can record them in the failure registry", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("relation does not exist"),
    );
    // The migration must re-throw — error handling belongs to runMigration,
    // not to the individual migration function.
    await expect(applyLibrarySyncMigration()).rejects.toThrow("relation does not exist");
  });

  it("a subsequent clean call succeeds after a previous failed call", async () => {
    const { db } = await import("@workspace/db");
    // First call throws on the first statement.
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("transient error"),
    );
    await expect(applyLibrarySyncMigration()).rejects.toThrow("transient error");

    vi.clearAllMocks();
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    // Second call with a healthy DB succeeds and runs both statements.
    await expect(applyLibrarySyncMigration()).resolves.not.toThrow();
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
