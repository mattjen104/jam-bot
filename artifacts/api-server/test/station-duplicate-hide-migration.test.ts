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
    const rendered = JSON.stringify(execute.mock.calls[0]?.[0]);

    expect(rendered).toContain("ROW_NUMBER");
    expect(rendered).toContain("stream_url");
    expect(rendered).toContain("duplicate_rank");
    expect(rendered).toContain("radio_browser");
    expect(rendered).toContain("hidden");
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
});