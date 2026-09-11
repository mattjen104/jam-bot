import type { DialStation } from "../hooks/useDialData";

export type DemoStationSort = "overlap" | "live" | "discovery" | "name";

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

export function buildDemoRadioSections({
  stations,
  hasData,
  focusedArtist,
  sort,
}: {
  stations: readonly DialStation[];
  hasData: boolean;
  focusedArtist: string | null;
  sort: DemoStationSort;
}): {
  crossingStations: DialStation[];
  rosterStations: DialStation[];
  showCrossings: boolean;
  orderedStations: DialStation[];
} {
  const crossingStations = focusedArtist
    ? [...stations]
    : stations.filter((station) => crossingTotal(station) > 0);

  crossingStations.sort((a, b) => {
    if (sort === "name") return a.station.name.localeCompare(b.station.name);
    if (sort === "live") {
      return Number(b.isLive) - Number(a.isLive)
        || crossingTotal(b) - crossingTotal(a);
    }
    if (sort === "discovery") {
      return crossingTotal(a) - crossingTotal(b);
    }
    return crossingTotal(b) - crossingTotal(a);
  });

  const showCrossings = hasData && crossingStations.length > 0;
  const crossingSlugs = showCrossings
    ? new Set(crossingStations.map((station) => station.station.slug))
    : new Set<string>();
  const rosterStations = ROSTER_SLUGS
    .map((slug) => stations.find((station) => station.station.slug === slug))
    .filter((station): station is DialStation => Boolean(station))
    .filter((station) => !crossingSlugs.has(station.station.slug));

  if (sort === "name") {
    rosterStations.sort((a, b) => a.station.name.localeCompare(b.station.name));
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