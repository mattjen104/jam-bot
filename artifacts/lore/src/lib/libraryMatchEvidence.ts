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

export type LibraryMatchEvidence =
  | { kind: "genre"; value: string; label: string }
  | { kind: "era"; value: ReleaseEra; label: string };

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
): LibraryMatchEvidence[] {
  if (!recording) return [];
  const facts: LibraryMatchEvidence[] = [];
  if (filters.genres.length > 0) {
    const active = new Set(canonicalGenres(filters.genres));
    const matchedGenres = canonicalGenres(recording.genres).filter((genre) => active.has(genre));
    facts.push(...matchedGenres.map((genre) => ({
      kind: "genre" as const,
      value: genre,
      label: genreLabel(genre),
    })));
  }

  const era = releaseEra(recording.releaseYear);
  if (
    era
    && filters.ages.includes(era)
    && (filters.decade == null
      || (era === "deep"
        && Math.floor(recording.releaseYear! / 10) * 10 === filters.decade))
  ) {
    facts.push({
      kind: "era",
      value: era,
      label: filters.decade != null ? `${filters.decade}s` : eraLabel(era),
    });
  }
  return facts;
}

export function removeLibraryMatchFilter(
  params: URLSearchParams,
  fact: LibraryMatchEvidence,
): void {
  if (fact.kind === "genre") {
    const genres = canonicalGenres((params.get("genre") ?? "").split(","))
      .filter((genre) => genre !== fact.value);
    if (genres.length > 0) params.set("genre", genres.join(","));
    else params.delete("genre");
    return;
  }

  const ages = (params.get("age") ?? "")
    .split(",")
    .filter((age): age is ReleaseEra => age === "current" || age === "catalog" || age === "deep")
    .filter((age) => age !== fact.value);
  if (ages.length > 0) params.set("age", ages.join(","));
  else params.delete("age");
  if (fact.value === "deep") params.delete("decade");
}