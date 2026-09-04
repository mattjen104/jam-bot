import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyLocalRosterRepair } from "../src/lore/local-roster-repair.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: {
      execute: vi.fn().mockResolvedValue({ rowCount: 0 }),
    },
  };
});

describe("applyLocalRosterRepair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the reviewed dublab and ByteFM aliases hidden under canonical rows", async () => {
    await expect(applyLocalRosterRepair()).resolves.toBeUndefined();

    const { db } = await import("@workspace/db");
    const execute = db.execute as ReturnType<typeof vi.fn>;
    expect(execute).toHaveBeenCalledTimes(2);

    const rendered = JSON.stringify(execute.mock.calls[1]?.[0]);
    expect(rendered).toContain("rb-0bb84fe1-e899-11e9-a96c-52543be04c81");
    expect(rendered).toContain("'dublab'");
    expect(rendered).toContain("'bytefm-hh-ukw'");
    expect(rendered).toContain("'bytefm-192k'");
    expect(rendered).toContain("hidden = true");
    expect(rendered).toContain("active = false");
    expect(rendered).toContain("automatic_cull_canonical_station_id");
  });
});