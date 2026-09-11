import { describe, expect, it } from "vitest";
import { BRO_ZONES_REVIEWED } from "../src/lore/bro-zones-migration.js";

describe("Bro Zones reviewed coverage", () => {
  it("keeps all eight canonical zones explicit and additive", () => {
    expect(BRO_ZONES_REVIEWED).toEqual([
      "seattle",
      "portland",
      "denver",
      "cleveland",
      "los-angeles",
      "redlands-inland-empire",
      "washington-dc",
      "north-carolina",
    ]);
    expect(new Set(BRO_ZONES_REVIEWED).size).toBe(8);
  });
});