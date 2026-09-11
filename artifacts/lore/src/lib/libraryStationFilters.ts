import {
  rowPassesAgeTierFilter,
  type AgeTier,
} from "./dialAgeFilter";
import type { DialStation, DialSpin } from "../hooks/useDialData";

export function parseLibraryAgeTiers(search: string): Set<AgeTier> {
  const values = new Set<AgeTier>();
  for (const value of new URLSearchParams(search).get("age")?.split(",") ?? []) {
    if (value === "first" || value === "current" || value === "catalog" || value === "deep") {
      values.add(value);
    }
  }
  return values;
}

export function parseLibraryGenres(search: string): Set<string> {
  return new Set(
    (new URLSearchParams(search).get("genres") ?? "")
      .split(",")
      .map((genre) => genre.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
}

export function writeLibraryFilter(
  params: URLSearchParams,
  key: "age" | "genres",
  values: ReadonlySet<string>,
): void {
  if (values.size) params.set(key, [...values].join(","));
  else params.delete(key);
}

function stationTracks(station: DialStation): DialSpin[] {
  const tracks = [
    station.liveTrack,
    ...station.shows.filter((show) => show.state === "live").map((show) => show.currentTrack),
  ];
  return tracks.filter((track): track is DialSpin => track != null);
}

export function stationPassesLibraryFilters(
  station: DialStation,
  activeAges: ReadonlySet<AgeTier>,
  activeGenres: ReadonlySet<string>,
): boolean {
  const tracks = stationTracks(station);
  const agePasses = activeAges.size === 0 || tracks.length === 0
    || tracks.some((track) => rowPassesAgeTierFilter(track.ageTier, activeAges));
  const genrePasses = activeGenres.size === 0 || tracks.length === 0
    || tracks.some((track) => {
      const genres = (track.genres ?? []).map((genre) => genre.toLocaleLowerCase());
      return genres.length === 0 || [...activeGenres].some((genre) => genres.includes(genre));
    });
  return agePasses && genrePasses;
}

export function filterLibraryStations(
  stations: readonly DialStation[],
  activeAges: ReadonlySet<AgeTier>,
  activeGenres: ReadonlySet<string>,
): DialStation[] {
  return stations.filter((station) => stationPassesLibraryFilters(station, activeAges, activeGenres));
}