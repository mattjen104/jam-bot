// Retired UI: FrontDoorRow bare-track cells were replaced by cover-led record cards.
import { describe, expect, it } from "vitest";
import { CROSSING_COVER_LIMIT, FIRST_PLAY_LIMIT } from "../src/components/dial/CoverRails";

describe("Explore cover-rail bounds", () => {
  it("keeps both current record rails bounded", () => {
    expect(CROSSING_COVER_LIMIT).toBe(8);
    expect(FIRST_PLAY_LIMIT).toBe(12);
  });
});