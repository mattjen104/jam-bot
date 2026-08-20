import { describe, expect, it } from "vitest";
import { ageDistribution } from "../src/lib/dialAgeDistribution";

describe("ageDistribution", () => {
  it("counts each tier and unknown data deterministically", () => {
    expect(ageDistribution([
      { ageTier: "first" }, { ageTier: "current" }, { ageTier: "current" },
      { ageTier: "catalog" }, { ageTier: "deep" }, { ageTier: null },
    ])).toMatchObject({
      counts: { first: 1, current: 2, catalog: 1, deep: 1 },
      unknown: 1,
      total: 6,
      label: "Premiere 1 · Current 2 · Catalog 1 · Deep 1 · Unknown 1",
    });
  });

  it("is honest when no sample is available", () => {
    expect(ageDistribution([]).detail).toBe("No track-age data is available.");
  });
});