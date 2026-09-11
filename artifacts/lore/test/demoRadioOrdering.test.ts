import { describe, expect, it } from "vitest";
import {
  buildDemoRadioSections,
  stationFreshness,
} from "../src/lib/demoRadioOrdering";
import type { DialStation } from "../src/hooks/useDialData";

function station(name: string, years: Array<number | null>): DialStation {
  return {
    station: { slug: name.toLowerCase(), name },
    isLive: true,
    recentReleaseYears: years.filter((year): year is number => year != null),
    shows: [{
      spins: years.map((releaseYear, index) => ({
        mbid: releaseYear == null ? null : `${name}-${index}`,
        releaseYear,
      })),
    }],
    crossings: 1,
    artistCrossings: 0,
    firstPlayCrossings: 0,
    weekCrossings: 1,
    weekArtistCrossings: 0,
    weekFirstPlayCrossings: 0,
    monthCrossings: 1,
    monthArtistCrossings: 0,
    monthFirstPlayCrossings: 0,
    lifetimeCrossings: 1,
    lifetimeArtistCrossings: 0,
    lifetimeFirstPlayCrossings: 0,
    topArtistNames: [],
    topArtistNames24h: [],
    topArtistNames7d: [],
    topArtistNamesLifetime: [],
    albumCrossings: [],
  } as DialStation;
}

describe("newest-music station ordering", () => {
  it("uses a robust median and requires sufficient resolved evidence", () => {
    expect(stationFreshness(station("Outlier", [1968, 1970, 2026]))).toBe(1970);
    expect(stationFreshness(station("Even", [1980, 2024]))).toBe(2002);
    expect(stationFreshness(station("Sparse", [2026]))).toBeNull();
    expect(stationFreshness(station("Unknown", [null, null]))).toBeNull();
  });

  it("keeps sparse and unknown stations visible after sufficiently evidenced stations", () => {
    const recent = station("Recent", [2022, 2024, 2025]);
    const older = station("Older", [1980, 1982, 1984]);
    const sparse = station("Sparse", [2026]);
    const unknown = station("Unknown", [null, null]);
    const result = buildDemoRadioSections({
      stations: [unknown, sparse, older, recent],
      hasData: true,
      focusedArtist: null,
      sort: "newest",
    });
    expect(result.orderedStations.map(({ station: item }) => item.name))
      .toEqual(["Recent", "Older", "Sparse", "Unknown"]);
  });

  it("shows the complete filtered result set even without listener crossings", () => {
    const ambient = station("Ambient", [2020, 2021]);
    ambient.lifetimeCrossings = 0;
    ambient.lifetimeArtistCrossings = 0;
    const result = buildDemoRadioSections({
      stations: [ambient],
      hasData: false,
      focusedArtist: null,
      sort: "overlap",
      forceAllStations: true,
    });
    expect(result.orderedStations).toEqual([ambient]);
  });
});