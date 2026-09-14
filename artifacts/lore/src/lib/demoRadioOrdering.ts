import type { DialStation } from "../hooks/useDialData";
import {
  demoStationEvidence,
  focusedArtistWeeklyCrossingCount,
  missionStationEvidence,
  missionStationOrder,
} from "./demoStationEvidence";
import { specialistSubcategoryForStation } from "./specialistCategories";

export type DemoStationSort = "overlap" | "live" | "discovery" | "name" | "newest";

export function stationFreshness(station: DialStation): number | null {
  // Median over a bounded sample resists one bad enrichment/outlier.
  const years = [...station.recentReleaseYears].sort((a, b) => a - b);
  if (years.length >= 2) {
    const upperIndex = Math.floor(years.length / 2);
    return years.length % 2 === 0
      ? (years[upperIndex - 1]! + years[upperIndex]!) / 2
      : years[upperIndex]!;
  }
  // A single live pulse is not enough evidence for a station freshness score.
  return null;
}

function crossingTotal(station: DialStation): number {
  return station.lifetimeCrossings + station.lifetimeArtistCrossings;
}

function discoveryScore(station: DialStation): number {
  return typeof station.score7d === "number" && Number.isFinite(station.score7d)
    ? station.score7d
    : crossingTotal(station);
}

export function selectSpecialistHighlightStations(
  stations: readonly DialStation[],
  excludedSlugs: ReadonlySet<string>,
  limit = 4,
): DialStation[] {
  const ranked = stations
    .filter((station) => station.station.stationCategories?.includes("specialist"))
    .filter((station) => !excludedSlugs.has(station.station.slug))
    .sort((a, b) =>
      Number(discoveryScore(b) > 0) - Number(discoveryScore(a) > 0)
      || Number(b.isLive) - Number(a.isLive)
      || discoveryScore(b) - discoveryScore(a)
      || a.station.name.localeCompare(b.station.name));

  const selected: DialStation[] = [];
  const represented = new Set<string>();
  for (const station of ranked) {
    const subcategory = specialistSubcategoryForStation(station.station);
    if (represented.has(subcategory)) continue;
    selected.push(station);
    represented.add(subcategory);
    if (selected.length === limit) return selected;
  }
  for (const station of ranked) {
    if (selected.includes(station)) continue;
    selected.push(station);
    if (selected.length === limit) break;
  }
  return selected;
}

export function selectBeyondHighlightStations(
  stations: readonly DialStation[],
  excludedSlugs: ReadonlySet<string>,
  limit = 4,
): DialStation[] {
  const missionStations = stations
    .filter((station) => missionStationEvidence(station) !== null)
    .filter((station) => !excludedSlugs.has(station.station.slug))
    .sort((a, b) => missionStationOrder(a) - missionStationOrder(b)
      || a.station.slug.localeCompare(b.station.slug))
    .slice(0, limit);
  if (missionStations.length === limit) return missionStations;

  const selectedSlugs = new Set([
    ...excludedSlugs,
    ...missionStations.map((station) => station.station.slug),
  ]);
  const fillers = stations
    .filter((station) => !selectedSlugs.has(station.station.slug))
    .filter((station) => station.station.automationClass !== "automated")
    .sort((a, b) =>
      Number(b.isLive) - Number(a.isLive)
      || discoveryScore(a) - discoveryScore(b)
      || a.station.name.localeCompare(b.station.name));
  return [...missionStations, ...fillers].slice(0, limit);
}

export function buildDemoRadioSections({
  stations,
  hasData,
  focusedArtist,
  focusedArtistMbid,
  sort,
  forceAllStations = false,
}: {
  stations: readonly DialStation[];
  hasData: boolean;
  focusedArtist: string | null;
  focusedArtistMbid?: string | null;
  sort: DemoStationSort;
  forceAllStations?: boolean;
}): {
  crossingStations: DialStation[];
  rosterStations: DialStation[];
  showCrossings: boolean;
  orderedStations: DialStation[];
} {
  const crossingStations = focusedArtist
    ? stations.filter((station) =>
      demoStationEvidence(station, hasData, focusedArtist, focusedArtistMbid).rank > 0)
    : sort === "newest" || forceAllStations
      ? [...stations]
    : sort === "discovery"
      ? stations.filter((station) =>
        discoveryScore(station) > 0 || missionStationEvidence(station) !== null)
    : !hasData
      ? stations.filter((station) => demoStationEvidence(station, false).kind === "current-set")
    : stations.filter((station) => discoveryScore(station) > 0);

  crossingStations.sort((a, b) => {
    if (focusedArtist) {
      const ae = demoStationEvidence(
        a,
        hasData,
        focusedArtist,
        focusedArtistMbid,
      );
      const be = demoStationEvidence(
        b,
        hasData,
        focusedArtist,
        focusedArtistMbid,
      );
      const focusedDifference = be.rank - ae.rank
        || focusedArtistWeeklyCrossingCount(b, focusedArtist, focusedArtistMbid)
          - focusedArtistWeeklyCrossingCount(a, focusedArtist, focusedArtistMbid)
        || discoveryScore(b) - discoveryScore(a);
      if (focusedDifference) return focusedDifference;
    }
    if (sort === "name") return a.station.name.localeCompare(b.station.name);
    if (sort === "newest") {
      const at = stationFreshness(a);
      const bt = stationFreshness(b);
      if (at == null && bt == null) return a.station.name.localeCompare(b.station.name);
      if (at == null) return 1;
      if (bt == null) return -1;
      return bt - at || a.station.name.localeCompare(b.station.name);
    }
    if (sort === "live") {
      return Number(b.isLive) - Number(a.isLive)
        || discoveryScore(b) - discoveryScore(a)
        || a.station.slug.localeCompare(b.station.slug);
    }
    if (sort === "discovery") {
      if (!forceAllStations) {
        const missionDifference = missionStationOrder(a) - missionStationOrder(b);
        if (Number.isFinite(missionDifference) && missionDifference) return missionDifference;
        if (missionStationEvidence(a) && !missionStationEvidence(b)) return -1;
        if (!missionStationEvidence(a) && missionStationEvidence(b)) return 1;
      }
      return discoveryScore(a) - discoveryScore(b)
        || a.station.slug.localeCompare(b.station.slug);
    }
    return discoveryScore(b) - discoveryScore(a)
      || a.station.slug.localeCompare(b.station.slug);
  });
  if (!hasData && !focusedArtist && !forceAllStations && sort !== "newest") {
    crossingStations.splice(12);
  }

  const showCrossings = crossingStations.length > 0;
  const crossingSlugs = showCrossings
    ? new Set(crossingStations.map((station) => station.station.slug))
    : new Set<string>();
  const showMissionGroup = !focusedArtist
    && !forceAllStations
    && sort === "overlap";
  const rosterStations = showMissionGroup
    ? stations
      .filter((station) => missionStationEvidence(station) !== null)
      .filter((station) => !crossingSlugs.has(station.station.slug))
      .sort((a, b) => missionStationOrder(a) - missionStationOrder(b)
        || a.station.slug.localeCompare(b.station.slug))
      .slice(0, 4)
    : [];

  if (sort === "name" || sort === "newest") {
    if (sort === "newest") {
      rosterStations.sort((a, b) => {
        const at = stationFreshness(a);
        const bt = stationFreshness(b);
        if (at == null && bt == null) return a.station.name.localeCompare(b.station.name);
        if (at == null) return 1;
        if (bt == null) return -1;
        return bt - at || a.station.name.localeCompare(b.station.name);
      });
    } else {
      rosterStations.sort((a, b) => a.station.name.localeCompare(b.station.name));
    }
  }

  return {
    crossingStations,
    rosterStations,
    showCrossings,
    orderedStations: [
      ...(showCrossings ? crossingStations : []),
      ...rosterStations,
    ],
  };
}