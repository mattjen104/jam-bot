import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { applyStationDuplicateHideMigration } from "../src/lore/station-duplicate-hide-migration.js";

function createDatabase() {
  const execute = vi.fn().mockResolvedValue({ rowCount: 3 });
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applyStationDuplicateHideMigration", () => {
  it("soft-hides only lower-ranked Radio Browser copies of exact streams", async () => {
    const { database, execute } = createDatabase();
    await expect(applyStationDuplicateHideMigration(database)).resolves.toBeUndefined();
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
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(applyStationDuplicateHideMigration(database)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("propagates provenance-backfill errors", async () => {
    const { database, execute } = createDatabase();
    execute
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockRejectedValueOnce(new Error("backfill unavailable"));

    await expect(applyStationDuplicateHideMigration(database)).rejects.toThrow(
      "backfill unavailable",
    );
  });
});