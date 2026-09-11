import { CANONICAL_GENRES, type CanonicalGenre } from "@workspace/song-enrichment";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";

export const LIBRARY_AGES = ["current", "catalog", "deep"] as const;
export type LibraryAge = typeof LIBRARY_AGES[number];

const GENRE_OPTIONS = CANONICAL_GENRES.map((genre) => ({
  value: genre,
  label: genre === "r&b"
    ? "R&B"
    : genre.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
  title: `Tracks positively classified as ${genre}`,
}));
const AGE_OPTIONS: Array<{ value: LibraryAge; label: string; title: string }> = [
  { value: "current", label: "Current", title: "Released within the last 18 months" },
  { value: "catalog", label: "Catalog", title: "Released 19–60 months ago" },
  { value: "deep", label: "Deep Catalog", title: "Released more than 60 months ago" },
];

export interface LibraryMetadataFilterProps {
  genres: string[];
  ages: LibraryAge[];
  decade?: number;
  decadeOptions?: number[];
  onGenresChange: (genres: string[]) => void;
  onAgesChange: (ages: LibraryAge[]) => void;
  onDecadeChange: (decade?: number) => void;
  onReset?: () => void;
}

/** Compact, shared metadata controls used by the station and song views. */
export function LibraryMetadataFilters({
  genres, ages, decade, decadeOptions, onGenresChange, onAgesChange, onDecadeChange, onReset,
}: LibraryMetadataFilterProps) {
  const genreSet = new Set(genres.filter((genre): genre is CanonicalGenre =>
    (CANONICAL_GENRES as readonly string[]).includes(genre),
  ));
  const ageSet = new Set(ages);
  return (
    <div className="library-metadata-filters" aria-label="Library metadata filters">
      <FilterDropdownMenu
        label="Genre"
        ariaLabel="Track genres"
        options={GENRE_OPTIONS}
        active={genreSet}
        onToggle={(genre) => {
          const next = new Set(genreSet);
          if (next.has(genre)) next.delete(genre);
          else next.add(genre);
          onGenresChange(CANONICAL_GENRES.filter((candidate) => next.has(candidate)));
        }}
        variant="chips"
        onClear={() => onGenresChange([])}
      />
      <FilterDropdownMenu
        label="Track age"
        ariaLabel="Track age"
        options={AGE_OPTIONS}
        active={ageSet}
        onToggle={(age) => {
          const next = new Set(ageSet);
          if (next.has(age)) next.delete(age);
          else next.add(age);
          onAgesChange(LIBRARY_AGES.filter((candidate) => next.has(candidate)));
        }}
        variant="chips"
        onClear={() => onAgesChange([])}
      />
      {onReset && (genres.length > 0 || ages.length > 0 || decade != null) ? (
        <button type="button" className="library-metadata-filters__reset" onClick={onReset}>Reset</button>
      ) : null}
      <label>
        <span className="sr-only">Decade</span>
        <select aria-label="Decade" value={decade ?? ""} onChange={(event) => {
          const value = Number(event.target.value);
          onDecadeChange(Number.isFinite(value) && value > 0 ? value : undefined);
        }}>
          <option value="">Decade</option>
          {(decadeOptions ?? []).map((value) => (
            <option key={value} value={value}>{value}s</option>
          ))}
        </select>
      </label>
    </div>
  );
}