import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyStationDiscoveryMigration } from "../src/lore/station-migration.js";

/**
 * Migration idempotency tests.
 *
 * These tests verify that `applyStationDiscoveryMigration` is safe to run
 * multiple times: Postgres `ADD COLUMN IF NOT EXISTS` is a no-op when the
 * column already exists, so a second call must succeed without throwing.
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

describe("applyStationDiscoveryMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes without throwing on first run", async () => {
    await expect(applyStationDiscoveryMigration()).resolves.not.toThrow();
  });

  it("is idempotent — succeeds on a second call (no-op ADD COLUMN IF NOT EXISTS)", async () => {
    await applyStationDiscoveryMigration();
    await expect(applyStationDiscoveryMigration()).resolves.not.toThrow();
    const { db } = await import("@workspace/db");
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it("executes exactly one SQL statement per call", async () => {
    await applyStationDiscoveryMigration();
    const { db } = await import("@workspace/db");
    expect((db.execute as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("propagates DB errors (so boot knows the migration failed)", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("syntax error at or near ALTER"),
    );
    await expect(applyStationDiscoveryMigration()).rejects.toThrow("syntax error");
  });

  it("passes a non-null Drizzle SQL object to db.execute", async () => {
    await applyStationDiscoveryMigration();
    const { db } = await import("@workspace/db");
    const sqlArg = (db.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    // Must be a truthy Drizzle SQL object (not a raw string or null).
    expect(sqlArg).toBeTruthy();
    expect(typeof sqlArg).toBe("object");
  });
});
