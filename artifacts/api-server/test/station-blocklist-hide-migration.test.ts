import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyStationBlocklistHideMigration } from "../src/lore/station-blocklist-hide-migration.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rowCount: 2 }),
    },
  };
});

describe("applyStationBlocklistHideMigration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the idempotent hide update for blocklisted and dead-end stations", async () => {
    await expect(applyStationBlocklistHideMigration()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(1);
    const sqlArg = execute.mock.calls[0]?.[0];
    expect(sqlArg).toBeTruthy();
    // The generated SQL object must reference both dead-end station slugs so
    // existing deployments have them hidden on the next restart.
    const rendered: string = JSON.stringify(sqlArg);
    expect(rendered).toContain("chmr");
    expect(rendered).toContain("cism");
  });

  it("propagates database errors", async () => {
    const { db } = await import("@workspace/db");
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(applyStationBlocklistHideMigration()).rejects.toThrow(
      "database unavailable",
    );
  });
});