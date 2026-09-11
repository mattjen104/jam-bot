import { describe, expect, it } from "vitest";
import { filterLibraryStations, parseLibraryAgeTiers, parseLibraryGenres } from "../src/lib/libraryStationFilters";

const spin = (ageTier: "current" | "deep" | null, genres: string[] | null) => ({
  ageTier, genres,
});
const station = (track: ReturnType<typeof spin>) => ({
  station: {} as never,
  isLive: true,
  shows: [],
  liveTrack: track,
  crossings: 0,
  artistCrossings: 0,
  firstPlayCrossings: 0,
  weekCrossings: 0,
  weekArtistCrossings: 0,
  weekFirstPlayCrossings: 0,
  monthCrossings: 0,
  monthArtistCrossings: 0,
  monthFirstPlayCrossings: 0,
  lifetimeCrossings: 0,
  lifetimeArtistCrossings: 0,
  lifetimeFirstPlayCrossings: 0,
  topArtistNames: [],
  topArtistNames24h: [],
  topArtistNames7d: [],
  topArtistNamesLifetime: [],
  albumCrossings: [],
});

describe("focused Library station filters", () => {
  it("round-trips URL-backed age and genre state", () => {
    expect([...parseLibraryAgeTiers("?age=current,deep,nope")]).toEqual(["current", "deep"]);
    expect([...parseLibraryGenres("?genres=Jazz, indie")]).toEqual(["jazz", "indie"]);
  });

  it("composes age and genre additively while unknown metadata passes", () => {
    const stations = [
      station(spin("current", ["jazz"])),
      station(spin("deep", ["rock"])),
      station(spin(null, null)),
    ];
    expect(filterLibraryStations(stations, new Set(["current"]), new Set(["jazz"]))).toHaveLength(2);
    expect(filterLibraryStations(stations, new Set(["current"]), new Set(["rock"]))).toHaveLength(1);
  });
});