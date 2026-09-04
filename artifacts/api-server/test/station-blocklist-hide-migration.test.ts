import { describe, expect, it, vi } from "vitest";
import type { db } from "@workspace/db";
import { applyStationBlocklistHideMigration } from "../src/lore/station-blocklist-hide-migration.js";

function createDatabase() {
  const execute = vi.fn().mockResolvedValue({ rowCount: 2 });
  return {
    database: { execute } as unknown as Pick<typeof db, "execute">,
    execute,
  };
}

describe("applyStationBlocklistHideMigration", () => {
  it("runs the idempotent hide update for blocklisted and dead-end stations", async () => {
    const { database, execute } = createDatabase();
    await expect(applyStationBlocklistHideMigration(database)).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(2);
    const hideSql = execute.mock.calls[0]?.[0];
    const backfillSql = execute.mock.calls[1]?.[0];
    expect(hideSql).toBeTruthy();
    expect(backfillSql).toBeTruthy();
    // The generated SQL object must reference both dead-end station slugs so
    // existing deployments have them hidden on the next restart.
    for (const statement of [hideSql, backfillSql]) {
      const rendered = JSON.stringify(statement);
      expect(rendered).toContain("chmr");
      expect(rendered).toContain("cism");
      expect(rendered).toContain("automatic_cull_reason");
      expect(rendered).toContain("missing_now_playing_source");
      expect(rendered).toContain("off_mission_name");
      expect(rendered).toContain("automatic_cull_canonical_station_id");
    }
    expect(JSON.stringify(backfillSql)).toContain("automatic_cull_reason IS NULL");
  });

  it("covers the coffee-shop/covers/mood patterns retroactively", async () => {
    const { database, execute } = createDatabase();
    await applyStationBlocklistHideMigration(database);
    const rendered: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    for (const pattern of [
      "exclusively ",
      "café calm",
      "cafe calm",
      "chillhop",
      "lofi girl",
      "lofi hip hop",
      "100 percent covers",
      "coffee",
      "cafe radio",
      "radio cafe",
      "lounge cafe",
      "cafe del mar",
      "hotel lounge",
      "0r - ",
      "study beats",
      "chill beats",
      "relaxing music",
      "background music",
      "drgnu -",
      "antenne niedersachsen relax",
    ]) {
      expect(rendered, pattern).toContain(pattern);
    }
  });

  it("never re-hides or reclassifies sleep-mode stations", async () => {
    const { database, execute } = createDatabase();
    await applyStationBlocklistHideMigration(database);
    const rendered: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    // The guard keeps sleep stations owned by the sleep migration — this
    // migration must skip rows where sleep_mode is already true.
    expect(rendered).toContain("sleep_mode");
  });

  it("propagates database errors", async () => {
    const { database, execute } = createDatabase();
    execute.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(applyStationBlocklistHideMigration(database)).rejects.toThrow(
      "database unavailable",
    );
  });

  it("propagates provenance-backfill errors", async () => {
    const { database, execute } = createDatabase();
    execute
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockRejectedValueOnce(new Error("backfill unavailable"));

    await expect(applyStationBlocklistHideMigration(database)).rejects.toThrow(
      "backfill unavailable",
    );
  });
});