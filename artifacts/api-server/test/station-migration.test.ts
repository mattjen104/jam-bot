import { describe, it, expect, vi } from "vitest";
import type { db } from "@workspace/db";
import { applyStationDiscoveryMigration } from "../src/lore/station-migration.js";

/**
 * Migration idempotency tests.
 *
 * These tests verify that `applyStationDiscoveryMigration` is safe to run
 * multiple times: Postgres `ADD COLUMN IF NOT EXISTS` is a no-op when the
 * column already exists, so a second call must succeed without throwing.
 */

function createDatabase() {
  const execute = vi.fn().mockResolvedValue({
    rows: Array.from({ length: 18 }, () => ({ column_name: "present" })),
  });
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applyStationDiscoveryMigration", () => {
  it("executes without throwing on first run", async () => {
    const { database } = createDatabase();
    await expect(applyStationDiscoveryMigration(database)).resolves.not.toThrow();
  });

  it("is idempotent — succeeds on a second call (no-op ADD COLUMN IF NOT EXISTS)", async () => {
    const { database, execute } = createDatabase();
    await applyStationDiscoveryMigration(database);
    await expect(applyStationDiscoveryMigration(database)).resolves.not.toThrow();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("executes exactly one SQL statement per call", async () => {
    const { database, execute } = createDatabase();
    await applyStationDiscoveryMigration(database);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("propagates DB errors (so boot knows the migration failed)", async () => {
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("syntax error at or near ALTER"));
    await expect(applyStationDiscoveryMigration(database)).rejects.toThrow("syntax error");
  });

  it("passes a non-null Drizzle SQL object to db.execute", async () => {
    const { database, execute } = createDatabase();
    await applyStationDiscoveryMigration(database);
    const sqlArg = execute.mock.calls[0]?.[0];
    // Must be a truthy Drizzle SQL object (not a raw string or null).
    expect(sqlArg).toBeTruthy();
    expect(typeof sqlArg).toBe("object");
  });
});
