// Retired UI: unified zone-row truncation and row-based scan specs no longer apply to Explore.
import { describe, expect, it } from "vitest";
import { CROSSING_COVER_LIMIT, FIRST_PLAY_LIMIT, FIRST_PLAY_REQUEST_LIMIT } from "../src/components/dial/CoverRails";

describe("Explore rail truncation", () => {
  it("bounds rendered covers while retaining a larger first-play request window", () => {
    expect(CROSSING_COVER_LIMIT).toBe(8);
    expect(FIRST_PLAY_LIMIT).toBe(12);
    expect(FIRST_PLAY_REQUEST_LIMIT).toBe(18);
  });
});