// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  parseSoundtapStations,
  selectVerifiedSoundtapMatches,
} from "../../src/scripts/audit-soundtap-schedules.js";

const station = {
  id: 1,
  slug: "station-kabc",
  name: "KABC — Community Radio",
  org: null,
  homepageUrl: "https://station.example",
  scheduleUrl: null,
  config: null,
};

describe("Soundtap callsign overlap selection", () => {
  it("selects exactly one matching callsign and never uses similar slugs", () => {
    const soundtap = parseSoundtapStations(
      "[KABC – Community Radio](https://soundtap.fm/stations/different-slug)\n",
    );
    const result = selectVerifiedSoundtapMatches(soundtap, [station]);

    expect(result.matches).toEqual([
      expect.objectContaining({ callsign: "KABC", station }),
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  it("excludes ambiguous callsigns rather than choosing a candidate", () => {
    const soundtap = parseSoundtapStations(
      "[KABC](https://soundtap.fm/stations/kabc)\n",
    );
    const result = selectVerifiedSoundtapMatches(soundtap, [
      station,
      { ...station, id: 2, slug: "another-kabc" },
    ]);

    expect(result.matches).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
  });
});