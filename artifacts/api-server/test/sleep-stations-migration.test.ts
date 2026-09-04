import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { applySleepStationsMigration } from "../src/lore/sleep-stations-migration.js";

function createDatabase() {
  const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applySleepStationsMigration", () => {
  it("removes utilities and keeps musical ambient rows in the legacy pool", async () => {
    const { database, execute } = createDatabase();
    await expect(applySleepStationsMigration(database)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(3);

    // Step 1 — idempotent DDL.
    const ddl: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(ddl).toContain("ADD COLUMN IF NOT EXISTS sleep_mode");

    // Step 2 removes every documented non-music utility pattern.
    const utilityUpdate: string = JSON.stringify(execute.mock.calls[1]?.[0]);
    for (const pattern of [
      "white noise",
      "rain sound",
      "sleep sound",
      "sleep radio",
      "baby sleep",
      "deep sleep",
      "sleeping pill",
      "music for sleep",
      "positively sleep",
      "nature radio sleep",
      "nature radio rain",
    ]) {
      expect(utilityUpdate).toContain(pattern);
    }
    expect(utilityUpdate).toContain("sleep_mode = false");
    expect(utilityUpdate).toContain("hidden");

    // Step 3 keeps musical SomaFM ambient variants in the pool.
    const ambientUpdate: string = JSON.stringify(execute.mock.calls[2]?.[0]);
    for (const pattern of [
      "somafm",
      "drone zone",
      "groove salad",
      "space station",
      "somafm-drone-zone",
      "somafm-dronezone",
      "somafm-groove-salad",
      "somafm-groovesalad",
      "somafm-space-station",
      "somafm-spacestation",
    ]) {
      expect(ambientUpdate).toContain(pattern);
    }
    expect(ambientUpdate).toContain("sleep_mode = true");
    expect(ambientUpdate).toContain("hidden");
    expect(ambientUpdate).not.toContain("hidden = false");
  });

  it("is idempotent — a second run issues the same statements without error", async () => {
    const { database, execute } = createDatabase();
    await applySleepStationsMigration(database);
    await applySleepStationsMigration(database);
    expect(execute).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(execute.mock.calls[4]?.[0]))
      .toBe(JSON.stringify(execute.mock.calls[1]?.[0]));
    expect(JSON.stringify(execute.mock.calls[5]?.[0]))
      .toBe(JSON.stringify(execute.mock.calls[2]?.[0]));
  });

  it("propagates database errors", async () => {
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(applySleepStationsMigration(database)).rejects.toThrow(
      "database unavailable",
    );
  });
});
