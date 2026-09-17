import { describe, expect, it } from "vitest";
import {
  buildDemoRadioSections,
  selectEditorialHighlightStations,
  selectSpecialistSubcategoryHighlightStations,
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

function missionStation(slug: string, name: string): DialStation {
  const result = station(name, []);
  result.station.slug = slug;
  result.station.streamUrl = `https://radio.example/${slug}`;
  result.station.automationClass = "human";
  result.lifetimeCrossings = 0;
  result.lifetimeArtistCrossings = 0;
  result.score7d = 0;
  return result;
}

describe("newest-music station ordering", () => {
  it("spreads era highlights across distinct decades before repeating one", () => {
    const eightiesLeader = station("80s Leader", [1984, 1985]);
    eightiesLeader.station.tags = ["80s"];
    eightiesLeader.lifetimeCrossings = 20;
    const eightiesRunnerUp = station("80s Runner-up", [1986, 1987]);
    eightiesRunnerUp.station.tags = ["80s"];
    eightiesRunnerUp.lifetimeCrossings = 19;
    const fifties = station("1950s Radio", [1955, 1956]);
    fifties.station.tags = ["50s"];
    const sixties = station("60s Radio", [1965, 1966]);
    sixties.station.tags = ["60s"];
    const twoThousands = station("2000s Radio", [2005, 2006]);
    twoThousands.station.tags = ["2000s"];
    for (const item of [
      eightiesLeader,
      eightiesRunnerUp,
      fifties,
      sixties,
      twoThousands,
    ]) {
      item.station.stationCategories = ["specialist"];
      item.station.eraGenreMode = true;
    }

    const result = selectSpecialistSubcategoryHighlightStations(
      [eightiesLeader, eightiesRunnerUp, fifties, sixties, twoThousands],
      "era",
      new Set(),
      4,
    );

    expect(result).toHaveLength(4);
    expect(result[0]?.station.name).toBe("80s Leader");
    expect(new Set(result.map((item) => item.station.name))).toEqual(new Set([
      "80s Leader", "1950s Radio", "60s Radio", "2000s Radio",
    ]));
    expect(result).not.toContain(eightiesRunnerUp);
  });

  it("uses only mission-led editorial stations without category or era fillers", () => {
    const ambient = station("Ambient FM", [2020, 2021]);
    ambient.station.stationCategories = ["specialist"];
    ambient.station.tags = ["ambient"];
    const jazz = station("Jazz FM", [2020, 2021]);
    jazz.station.stationCategories = ["specialist"];
    jazz.station.tags = ["jazz"];
    const fifties = station("1950s Radio", [1955, 1956]);
    fifties.station.stationCategories = ["specialist"];
    fifties.station.tags = ["50s"];
    fifties.station.eraGenreMode = true;
    const sixties = station("1960s Radio", [1965, 1966]);
    sixties.station.stationCategories = ["specialist"];
    sixties.station.tags = ["60s"];
    sixties.station.eraGenreMode = true;
    const wfmu = missionStation("wfmu", "WFMU");

    const result = selectEditorialHighlightStations(
      [ambient, jazz, fifties, sixties, wfmu],
      new Set(),
    );

    expect(result).toHaveLength(1);
    expect(result.map((item) => item.station.slug)).toEqual(["wfmu"]);
    expect(result).not.toContain(ambient);
    expect(result).not.toContain(jazz);
    expect(result).not.toContain(fifties);
    expect(result).not.toContain(sixties);
  });

  it("uses the seven-day rarity score for the default overlap order", () => {
    const rawLeader = station("Raw leader", [2020, 2021]);
    rawLeader.lifetimeCrossings = 100;
    rawLeader.score7d = 0.2;
    const rarityLeader = station("Rarity leader", [2020, 2021]);
    rarityLeader.lifetimeCrossings = 2;
    rarityLeader.score7d = 0.9;

    const result = buildDemoRadioSections({
      stations: [rawLeader, rarityLeader],
      hasData: true,
      focusedArtist: null,
      sort: "overlap",
    });

    expect(result.crossingStations.map((item) => item.station.name))
      .toEqual(["Rarity leader", "Raw leader"]);
  });

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

  it("appends bounded, deduplicated mission stations after personal matches", () => {
    const personal = station("Personal", [2020, 2021]);
    const wfmu = missionStation("wfmu", "WFMU");
    const result = buildDemoRadioSections({
      stations: [wfmu, personal],
      hasData: true,
      focusedArtist: null,
      sort: "overlap",
    });
    expect(result.crossingStations).toEqual([personal]);
    expect(result.rosterStations).toEqual([wfmu]);
    expect(result.orderedStations).toEqual([personal, wfmu]);
  });

  it("admits zero-crossover mission stations to Discovery but not focused results", () => {
    const wfmu = missionStation("wfmu", "WFMU");
    expect(buildDemoRadioSections({
      stations: [wfmu],
      hasData: true,
      focusedArtist: null,
      sort: "discovery",
    }).orderedStations).toEqual([wfmu]);
    expect(buildDemoRadioSections({
      stations: [wfmu],
      hasData: true,
      focusedArtist: "Stereolab",
      sort: "overlap",
    }).orderedStations).toEqual([]);
  });

  it("keeps every station in a settled global artist membership result", () => {
    const localEvidence = station("Local evidence", [2020, 2021]);
    localEvidence.topArtistNames = ["Broadcast"];
    const globalOnly = station("Global only", [2020, 2021]);

    const result = buildDemoRadioSections({
      stations: [localEvidence, globalOnly],
      hasData: true,
      focusedArtist: "Broadcast",
      focusedMembershipSettled: true,
      sort: "overlap",
    });

    expect(result.crossingStations).toHaveLength(2);
    expect(result.crossingStations).toEqual(expect.arrayContaining([
      localEvidence,
      globalOnly,
    ]));
  });

  it("rejects mission stations the real player cannot tune", () => {
    const invalid = missionStation("wfmu", "WFMU");
    invalid.station.streamUrl = "http://insecure.example/wfmu";
    invalid.station.relayUrl = null;
    invalid.station.playbackCandidates = [];
    const result = buildDemoRadioSections({
      stations: [invalid],
      hasData: true,
      focusedArtist: null,
      sort: "discovery",
    });
    expect(result.orderedStations).toEqual([]);
  });

  it("does not add the mission shelf to an actively filtered result", () => {
    const wfmu = missionStation("wfmu", "WFMU");
    const result = buildDemoRadioSections({
      stations: [wfmu],
      hasData: true,
      focusedArtist: null,
      sort: "overlap",
      forceAllStations: true,
    });
    expect(result.rosterStations).toEqual([]);
    expect(result.orderedStations).toEqual([wfmu]);
  });

  it("keeps filtered Discovery ordering independent of the mission roster", () => {
    const wfmu = missionStation("wfmu", "WFMU");
    wfmu.score7d = 0.8;
    const ordinary = station("Ordinary", [2020, 2021]);
    ordinary.score7d = 0.2;
    const result = buildDemoRadioSections({
      stations: [wfmu, ordinary],
      hasData: true,
      focusedArtist: null,
      sort: "discovery",
      forceAllStations: true,
    });
    expect(result.rosterStations).toEqual([]);
    expect(result.orderedStations).toEqual([ordinary, wfmu]);
  });
});