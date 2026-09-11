import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CANONICAL_GENRES, type CanonicalGenre } from "@workspace/song-enrichment";
import { FilterDropdownMenu } from "./dial/FilterDropdownMenu";
import { STATION_CATEGORY_DEFINITIONS, type StationCategory } from "../lib/dialCategories";
import { BRO_ZONE_DEFINITIONS, type BroZone } from "../lib/broZones";

export const LIBRARY_AGES = ["current", "catalog", "deep"] as const;
export type LibraryAge = typeof LIBRARY_AGES[number];
export type LibraryLens = "all" | "artist" | "genre" | "era";

export const LIBRARY_GENRE_OPTIONS = CANONICAL_GENRES.map((genre) => ({
  value: genre,
  label: genre === "r&b"
    ? "R&B"
    : genre.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "),
  title: `Tracks positively classified as ${genre}`,
}));
export const LIBRARY_ERA_OPTIONS: Array<{ value: LibraryAge; label: string; title: string }> = [
  { value: "current", label: "Current", title: "Released within the last 18 months" },
  { value: "catalog", label: "Catalog", title: "Released 19–60 months ago" },
  { value: "deep", label: "Deep Catalog", title: "Released more than 60 months ago" },
];

export function deriveLibraryLens(search: string): LibraryLens {
  const params = new URLSearchParams(search);
  const explicit = params.get("libraryLens");
  if (explicit === "all" || explicit === "artist" || explicit === "genre" || explicit === "era") {
    return explicit;
  }
  if (params.get("focus")) return "artist";
  if (params.get("genre")) return "genre";
  if (params.get("age") || params.get("decade")) return "era";
  return "all";
}

export function writeLibraryLens(params: URLSearchParams, lens: LibraryLens): void {
  params.set("libraryLens", lens);
  if (lens !== "artist") {
    params.delete("focus");
    params.delete("openAlbum");
  }
  if (lens !== "genre") params.delete("genre");
  if (lens !== "era") {
    params.delete("age");
    params.delete("decade");
  }
}

export interface LibraryMetadataFilterProps {
  mode?: "all" | "genre" | "era";
  genres: string[];
  ages: LibraryAge[];
  decade?: number;
  decadeOptions?: number[];
  onGenresChange: (genres: string[]) => void;
  onAgesChange: (ages: LibraryAge[]) => void;
  onDecadeChange: (decade?: number) => void;
  onReset?: () => void;
}

/** Lens-specific choices. Only the active lens contributes eligibility state. */
export function LibraryMetadataFilters({
  mode = "all", genres, ages, decade, decadeOptions, onGenresChange, onAgesChange, onDecadeChange, onReset,
}: LibraryMetadataFilterProps) {
  const genreSet = new Set(genres.filter((genre): genre is CanonicalGenre =>
    (CANONICAL_GENRES as readonly string[]).includes(genre),
  ));
  const ageSet = new Set(ages);
  return (
    <div className="library-metadata-filters" aria-label="Library lens choices">
      {mode !== "era" && <FilterDropdownMenu
        label="Choose genre"
        ariaLabel="Track genres"
        options={LIBRARY_GENRE_OPTIONS}
        active={genreSet}
        onToggle={(genre) => {
          const next = new Set(genreSet);
          if (next.has(genre)) next.delete(genre);
          else next.add(genre);
          onGenresChange(CANONICAL_GENRES.filter((candidate) => next.has(candidate)));
        }}
        variant="chips"
        onClear={() => onGenresChange([])}
      />}
      {mode !== "genre" && <FilterDropdownMenu
        label="Browse era"
        ariaLabel="Track age"
        options={LIBRARY_ERA_OPTIONS}
        active={ageSet}
        onToggle={(age) => {
          const next = new Set(ageSet);
          if (next.has(age)) next.delete(age);
          else next.add(age);
          onAgesChange(LIBRARY_AGES.filter((candidate) => next.has(candidate)));
        }}
        variant="chips"
        onClear={() => onAgesChange([])}
      />}
      {onReset && (genres.length > 0 || ages.length > 0 || decade != null) ? (
        <button type="button" className="library-metadata-filters__reset" onClick={onReset}>Reset</button>
      ) : null}
      {mode !== "genre" && <label>
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
      </label>}
    </div>
  );
}

interface LibraryStationFiltersProps {
  categories: ReadonlySet<StationCategory>;
  broZonesActive: boolean;
  broZones: ReadonlySet<BroZone>;
  broZoneCounts: { combined: number; byZone: Record<BroZone, number> };
  onToggleCategory: (category: StationCategory) => void;
  onToggleBroZonesCollection: () => void;
  onToggleBroZone: (zone: BroZone) => void;
  onClear: () => void;
}

export function LibraryStationFilters({
  categories,
  broZonesActive,
  broZones,
  broZoneCounts,
  onToggleCategory,
  onToggleBroZonesCollection,
  onToggleBroZone,
  onClear,
}: LibraryStationFiltersProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeCount = categories.size + (broZonesActive ? (broZones.size || 1) : 0);
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [close, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`library-station-filters__trigger${activeCount ? " is-active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        Filters{activeCount ? ` · ${activeCount}` : ""}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="library-station-filters__panel"
          role="dialog"
          aria-modal="false"
          aria-label="Station filters"
        >
          <div className="library-station-filters__heading">
            <strong>Filters</strong>
            <button type="button" onClick={onClear} disabled={activeCount === 0}>Clear all</button>
          </div>
          <fieldset>
            <legend>Station type</legend>
            {STATION_CATEGORY_DEFINITIONS.map(({ cat, label, title }) => (
              <label key={cat} title={title}>
                <input type="checkbox" checked={categories.has(cat)} onChange={() => onToggleCategory(cat)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Bro Zones</legend>
            <label>
              <input type="checkbox" checked={broZonesActive && broZones.size === 0} onChange={onToggleBroZonesCollection} />
              <span>All Bro Zones · {broZoneCounts.combined}</span>
            </label>
            {BRO_ZONE_DEFINITIONS.map(({ key, label }) => (
              <label key={key}>
                <input type="checkbox" checked={broZones.has(key)} onChange={() => onToggleBroZone(key)} />
                <span>{label} · {broZoneCounts.byZone[key]}</span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="library-station-filters__done" onClick={() => close(true)}>Done</button>
        </div>,
        document.body,
      )}
    </>
  );
}