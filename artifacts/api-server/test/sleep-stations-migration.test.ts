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

  it("adds the sleep_mode column and classifies matching rows", async () => {
    await expect(applySleepStationsMigration()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(2);

    // Step 1 — idempotent DDL.
    const ddl: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(ddl).toContain("ADD COLUMN IF NOT EXISTS sleep_mode");

    // Step 2 — classification UPDATE must cover every documented sleep
    // pattern and all three SomaFM ambient channels.
    const update: string = JSON.stringify(execute.mock.calls[1]?.[0]);
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
      // SomaFM ambient channels — name-based match covers all variants…
      "somafm",
      "drone zone",
      "groove salad",
      "space station",
      // …plus exact slug fallbacks.
      "somafm-drone-zone",
      "somafm-dronezone",
      "somafm-groove-salad",
      "somafm-groovesalad",
      "somafm-space-station",
      "somafm-spacestation",
    ]) {
      expect(update).toContain(pattern);
    }
    // Sets both flags…
    expect(update).toContain("sleep_mode = true");
    expect(update).toContain("hidden");
    // …and must NOT gate on the current hidden value — rows already hidden
    // for another reason still get classified (idempotent re-runs included).
    expect(update).not.toContain("hidden = false");
  });

  it("is idempotent — a second run issues the same statements without error", async () => {
    await applySleepStationsMigration();
    await applySleepStationsMigration();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(4);
    const firstUpdate = JSON.stringify(execute.mock.calls[1]?.[0]);
    const secondUpdate = JSON.stringify(execute.mock.calls[3]?.[0]);
    expect(secondUpdate).toBe(firstUpdate);
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
