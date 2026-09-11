import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATION_CATEGORY_DEFINITIONS, type StationCategory } from "../lib/dialCategories";
import { BRO_ZONE_DEFINITIONS, type BroZone } from "../lib/broZones";
import { SPECIALIST_SUBCATEGORY_DEFINITIONS, type SpecialistSubcategory } from "../lib/specialistCategories";

/** Legacy values remain accepted by URL migration callers, but never render
 * as a selectable demo lens. */
export type LibraryLens = "all" | "artist" | "genre" | "era";

export function deriveLibraryLens(_search: string): LibraryLens {
  return "artist";
}

export function writeLibraryLens(params: URLSearchParams, _lens: LibraryLens): void {
  const legacyGenre = params.get("genre");
  const legacyEra = params.get("age") || params.get("decade");
  params.set("libraryLens", "artist");
  params.delete("genre");
  params.delete("age");
  params.delete("decade");
  // Legacy specialist links become the station category filter. Preserve only
  // values that map unambiguously to our shared station taxonomy.
  if (legacyGenre || legacyEra) {
    const categories = new Set(params.get("categories")?.split(",").filter(Boolean) ?? []);
    categories.add("specialist");
    params.set("categories", STATION_CATEGORY_DEFINITIONS
      .map(({ cat }) => cat)
      .filter((cat) => categories.has(cat))
      .join(","));
    const values = legacyGenre ? legacyGenre.split(",").map(value => {
      const lower = value.trim().toLowerCase();
      if (/ambient|chill|lounge/.test(lower)) return "ambient";
      if (/folk|country|celtic/.test(lower)) return "folk";
      if (/rock|metal|punk/.test(lower)) return "rock";
      if (/jazz|blues/.test(lower)) return "jazz";
      if (/electronic|dance|techno|house/.test(lower)) return "electronic";
      if (/world|latin|reggae/.test(lower)) return "world";
      if (/soul|funk|groove|r&b|rnb/.test(lower)) return "groove";
      if (/classical|opera/.test(lower)) return "classical";
      return null;
    }).filter((value): value is NonNullable<typeof value> => value != null) : [];
    if (legacyEra) (values as string[]).push("era");
    if (values.length) params.set("specialistCategories", [...new Set(values)].join(","));
  }
}

export function hasLegacyLibraryMetadata(search: string): boolean {
  const params = new URLSearchParams(search);
  const lens = params.get("libraryLens");
  return lens === "all"
    || lens === "genre"
    || lens === "era"
    || params.has("genre")
    || params.has("age")
    || params.has("decade");
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
  specialistSubcategories?: ReadonlySet<SpecialistSubcategory>;
  onToggleSpecialistSubcategory?: (subcategory: SpecialistSubcategory) => void;
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
  specialistSubcategories = new Set(),
  onToggleSpecialistSubcategory,
}: LibraryStationFiltersProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeCount = categories.size + specialistSubcategories.size + (broZonesActive ? (broZones.size || 1) : 0);
  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusableSelector = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[href]",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const focusFirst = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])];
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!panelRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
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
          aria-modal="true"
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
          {categories.has("specialist") && onToggleSpecialistSubcategory ? (
            <fieldset>
              <legend>Specialist sounds</legend>
              {SPECIALIST_SUBCATEGORY_DEFINITIONS.map(({ id, label }) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={specialistSubcategories.has(id)}
                    onChange={() => onToggleSpecialistSubcategory(id)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
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