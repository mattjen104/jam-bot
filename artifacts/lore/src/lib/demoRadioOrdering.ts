import type { DialStation } from "../hooks/useDialData";

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

const ROSTER_SLUGS = [
  "kcrw",
  "kexp",
  "wfmu",
  "worldwide-fm",
  "wxyc",
  "xray-fm",
  "kuvo",
  "wruw",
];

function crossingTotal(station: DialStation): number {
  return station.lifetimeCrossings + station.lifetimeArtistCrossings;
}

function discoveryScore(station: DialStation): number {
  return typeof station.score7d === "number" && Number.isFinite(station.score7d)
    ? station.score7d
    : crossingTotal(station);
}

export function buildDemoRadioSections({
  stations,
  hasData,
  focusedArtist,
  sort,
  forceAllStations = false,
}: {
  stations: readonly DialStation[];
  hasData: boolean;
  focusedArtist: string | null;
  sort: DemoStationSort;
  forceAllStations?: boolean;
}): {
  crossingStations: DialStation[];
  rosterStations: DialStation[];
  showCrossings: boolean;
  orderedStations: DialStation[];
} {
  const crossingStations = focusedArtist || sort === "newest" || forceAllStations
    ? [...stations]
    : stations.filter((station) => discoveryScore(station) > 0);

  crossingStations.sort((a, b) => {
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
      return discoveryScore(a) - discoveryScore(b)
        || a.station.slug.localeCompare(b.station.slug);
    }
    return discoveryScore(b) - discoveryScore(a)
      || a.station.slug.localeCompare(b.station.slug);
  });

  const showCrossings = (hasData || forceAllStations || sort === "newest")
    && crossingStations.length > 0;
  const crossingSlugs = showCrossings
    ? new Set(crossingStations.map((station) => station.station.slug))
    : new Set<string>();
  const rosterStations = ROSTER_SLUGS
    .map((slug) => stations.find((station) => station.station.slug === slug))
    .filter((station): station is DialStation => Boolean(station))
    .filter((station) => !crossingSlugs.has(station.station.slug));

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