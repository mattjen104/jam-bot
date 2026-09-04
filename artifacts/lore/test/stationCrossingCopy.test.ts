import { describe, expect, it } from "vitest";
import { stationCrossingSentence } from "../src/lib/stationCrossingCopy";

describe("stationCrossingSentence", () => {
  it("names one artist", () => {
    expect(stationCrossingSentence(["Broadcast"], 1))
      .toBe("Played Broadcast from your library.");
  });

  it("uses an Oxford comma and reports remaining crossings", () => {
    expect(stationCrossingSentence(["Broadcast", "Stereolab", "Yo La Tengo"], 6))
      .toBe("Played Broadcast, Stereolab, and Yo La Tengo, and 3 more from your library.");
  });

  it("deduplicates names and omits unsupported generic copy", () => {
    expect(stationCrossingSentence(["Broadcast", " Broadcast "], 2))
      .toBe("Played Broadcast, and 1 more from your library.");
    expect(stationCrossingSentence([], 4)).toBeNull();
  });
});