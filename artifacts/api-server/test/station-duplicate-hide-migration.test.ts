import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyStationDuplicateHideMigration } from "../src/lore/station-duplicate-hide-migration.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rowCount: 3 }),
    },
  };
});

describe("applyStationDuplicateHideMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("soft-hides only lower-ranked Radio Browser copies of exact streams", async () => {
    await expect(applyStationDuplicateHideMigration()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(2);
    const rendered = JSON.stringify(execute.mock.calls[0]?.[0]);
    const backfill = JSON.stringify(execute.mock.calls[1]?.[0]);

    expect(rendered).toContain("FIRST_VALUE");
    expect(rendered).toContain("ROW_NUMBER");
    expect(rendered).toContain("stream_url");
    expect(rendered).toContain("duplicate_rank");
    expect(rendered).toContain("radio_browser");
    expect(rendered).toContain("hidden");
    expect(rendered).toContain("automatic_cull_reason");
    expect(rendered).toContain("duplicate_stream");
    expect(rendered).toContain("automatic_cull_canonical_station_id");
    expect(rendered).toContain("canonical_id");

    expect(backfill).toContain("visible_ranked");
    expect(backfill).toContain("automatic_cull_reason IS NULL");
    expect(backfill).toContain("duplicate_stream");
    expect(backfill).toContain("automatic_cull_canonical_station_id");
  });

  it("propagates database errors", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(applyStationDuplicateHideMigration()).rejects.toThrow(
      "database unavailable",
    );
  });

  it("propagates provenance-backfill errors", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockRejectedValueOnce(new Error("backfill unavailable"));

    await expect(applyStationDuplicateHideMigration()).rejects.toThrow(
      "backfill unavailable",
    );
  });
});