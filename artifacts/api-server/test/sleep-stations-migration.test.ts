import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySleepStationsMigration } from "../src/lore/sleep-stations-migration.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rowCount: 3 }),
    },
  };
});

describe("applySleepStationsMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes utilities and keeps musical ambient rows in the legacy pool", async () => {
    await expect(applySleepStationsMigration()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
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
    await applySleepStationsMigration();
    await applySleepStationsMigration();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(6);
    expect(JSON.stringify(execute.mock.calls[4]?.[0]))
      .toBe(JSON.stringify(execute.mock.calls[1]?.[0]));
    expect(JSON.stringify(execute.mock.calls[5]?.[0]))
      .toBe(JSON.stringify(execute.mock.calls[2]?.[0]));
  });

  it("propagates database errors", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(applySleepStationsMigration()).rejects.toThrow(
      "database unavailable",
    );
  });
});
