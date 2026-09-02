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

  it("covers the coffee-shop/covers/mood patterns retroactively", async () => {
    await applyStationBlocklistHideMigration();
    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
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
    await applyStationBlocklistHideMigration();
    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    const rendered: string = JSON.stringify(execute.mock.calls[0]?.[0]);
    // The guard keeps sleep stations owned by the sleep migration — this
    // migration must skip rows where sleep_mode is already true.
    expect(rendered).toContain("sleep_mode");
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