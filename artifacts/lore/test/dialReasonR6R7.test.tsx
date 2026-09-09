// Retired UI: r6/r7 station-row labels were removed with the front-door zone feed.
import { describe, expect, it } from "vitest";
import { CROSSING_COVER_LIMIT } from "../src/components/dial/CoverRails";

describe("Current crossing presentation", () => {
  it("uses a bounded cover rail instead of reason-labelled station rows", () => {
    expect(CROSSING_COVER_LIMIT).toBe(8);
  });
});