import {
  canonicalGenres,
  releaseEra,
  type ReleaseEra,
} from "@workspace/song-enrichment";

export interface LibraryMatchEvidenceInput {
  genres?: readonly string[] | null;
  releaseYear?: number | null;
}

export interface LibraryMatchFilters {
  genres: readonly string[];
  ages: readonly ReleaseEra[];
  decade?: number;
}

function genreLabel(genre: string): string {
  return genre === "r&b"
    ? "R&B"
    : genre.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ");
}

function eraLabel(era: ReleaseEra): string {
  if (era === "current") return "Current";
  if (era === "catalog") return "Catalog";
  return "Deep Catalog";
}

/** Known recording facts that positively explain the active Library filters. */
export function libraryMatchEvidence(
  recording: LibraryMatchEvidenceInput | null | undefined,
  filters: LibraryMatchFilters,
): string[] {
  if (!recording) return [];
  const facts: string[] = [];
  if (filters.genres.length > 0) {
    const active = new Set(canonicalGenres(filters.genres));
    const matchedGenres = canonicalGenres(recording.genres).filter((genre) => active.has(genre));
    if (matchedGenres.length > 0) facts.push(matchedGenres.map(genreLabel).join(" / "));
  }

  const era = releaseEra(recording.releaseYear);
  if (
    era
    && filters.ages.includes(era)
    && (filters.decade == null
      || (era === "deep"
        && Math.floor(recording.releaseYear! / 10) * 10 === filters.decade))
  ) {
    facts.push(filters.decade != null ? `${filters.decade}s` : eraLabel(era));
  }
  return facts;
}