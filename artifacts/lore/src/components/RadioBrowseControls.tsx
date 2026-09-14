import { useState, type FormEvent } from "react";
import { MapPin, RotateCcw, SlidersHorizontal, X } from "lucide-react";
import {
  BRO_ZONE_DEFINITIONS,
  type BroZone,
} from "../lib/broZones";
import {
  RADIO_BROWSE_DECADES,
  RADIO_BROWSE_FORMATS,
  RADIO_BROWSE_STATION_TYPES,
  RADIO_BROWSE_LENS_LABELS,
  RADIO_SOUND_DESTINATIONS,
  RADIO_BROWSE_SORTS,
  type CoarseLocality,
  type RadioBrowseDecade,
  type RadioBrowseFilters,
  type RadioBrowseLens,
  type RadioBrowseSort,
  type RadioBrowseState,
  normalizeZip,
  patchRadioBrowseFilters,
  resetRadioBrowseState,
  setRadioBrowseLens,
  setRadioBrowseSort,
  toggleRadioFilter,
} from "../lib/radioBrowseState";
import { recordRadioBrowseEvent } from "../lib/radioBrowseInstrumentation";
import type { RadioBrowseFormat } from "../lib/radioBrowseState";
import type { AgeTier } from "../lib/dialAgeFilter";

export interface RadioBrowseControlsProps {
  state: RadioBrowseState;
  onStateChange: (state: RadioBrowseState) => void;
  onLocalityChange?: (locality: CoarseLocality | null) => void;
  resultCount?: number;
  hasTasteEvidence?: boolean;
}

const SORT_LABELS: Record<RadioBrowseSort, string> = {
  recommended: "Recommended",
  nearest: "Nearest",
  "best-match": "Best match",
  "rarest-crossing": "Rarest crossing",
  "live-now": "Live now",
  name: "Name",
};

const AGE_OPTIONS: readonly { value: AgeTier; label: string }[] = [
  { value: "first", label: "Playing now · Premiere" },
  { value: "current", label: "Playing now · Current" },
  { value: "catalog", label: "Playing now · Catalog" },
  { value: "deep", label: "Playing now · Deep" },
];

function toggleFamily<T>(
  state: RadioBrowseState,
  key: keyof Pick<RadioBrowseFilters, "stationTypes" | "specialistFormats" | "decades" | "playingNow" | "broZones">,
  value: T,
  family: string,
  onStateChange: (state: RadioBrowseState) => void,
) {
  const next = toggleRadioFilter(state.filters[key] as readonly T[], value);
  recordRadioBrowseEvent("filter_selected", { filterFamily: family });
  onStateChange(patchRadioBrowseFilters(state, { [key]: next }));
}

function localityLabel(locality: CoarseLocality | null): string {
  if (!locality) return "Set locality";
  return [locality.city, locality.state].filter(Boolean).join(", ") || "Coarse locality set";
}

export function RadioBrowseControls({
  state,
  onStateChange,
  onLocalityChange,
  resultCount,
  hasTasteEvidence = false,
}: RadioBrowseControlsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [localityOpen, setLocalityOpen] = useState(!state.locality);
  const [zipDraft, setZipDraft] = useState(state.locality?.zip ?? "");
  const [cityDraft, setCityDraft] = useState(state.locality?.city ?? "");
  const [regionDraft, setRegionDraft] = useState(state.locality?.state ?? "");
  const availableLenses = hasTasteEvidence
    ? (["local", "for-you", "all"] as const)
    : (["local", "all"] as const);
  const updateLens = (lens: RadioBrowseLens) => {
    recordRadioBrowseEvent("lens_selected", { filterFamily: lens });
    onStateChange(setRadioBrowseLens(state, lens));
  };
  const submitLocality = (event: FormEvent) => {
    event.preventDefault();
    const zip = normalizeZip(zipDraft);
    const city = cityDraft.trim().replace(/\s+/g, " ").slice(0, 80);
    const region = regionDraft.trim().toUpperCase().slice(0, 2);
    if (!zip && !(city && region)) return;
    const locality = zip ? { zip } : { city, state: region };
    onLocalityChange?.(locality);
    onStateChange({ ...state, locality, lens: "local", sort: "recommended", page: 1 });
    setLocalityOpen(false);
  };
  const clearLocality = () => {
    onLocalityChange?.(null);
    onStateChange({
      ...state,
      locality: null,
      lens: state.lens === "local" ? "all" : state.lens,
      sort: state.lens === "local" ? "recommended" : state.sort,
      page: 1,
    });
    setZipDraft("");
    setCityDraft("");
    setRegionDraft("");
  };
  const reset = () => {
    onStateChange(resetRadioBrowseState(state));
    recordRadioBrowseEvent("result_quality", { resultCount });
  };
  const filters = state.filters;
  const activeFilterCount = filters.stationTypes.length
    + filters.specialistFormats.length
    + filters.decades.length
    + filters.playingNow.length
    + filters.broZones.length
    + Number(filters.followedOnly)
    + Number(filters.supportOnly);

  return (
    <section className="radio-browse-controls" aria-label="Radio browse controls" data-testid="radio-browse-controls">
      <div className="radio-browse-controls__top">
        <div className="radio-browse-controls__lenses" aria-label="Radio browse lens">
          {availableLenses.map((lens) => (
            <button
              type="button"
              key={lens}
              aria-pressed={state.lens === lens}
              className={state.lens === lens ? "is-active" : ""}
              onClick={() => updateLens(lens)}
              data-testid={`radio-browse-lens-${lens}`}
            >
              {RADIO_BROWSE_LENS_LABELS[lens]}
            </button>
          ))}
        </div>
        <div className="radio-browse-controls__actions">
          <button type="button" onClick={() => setLocalityOpen((open) => !open)} aria-expanded={localityOpen}>
            <MapPin aria-hidden="true" size={14} />
            {localityLabel(state.locality)}
          </button>
          <button type="button" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
            <SlidersHorizontal aria-hidden="true" size={14} />
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
          <button type="button" onClick={reset} aria-label="Reset radio browse">
            <RotateCcw aria-hidden="true" size={14} /> Reset
          </button>
        </div>
      </div>

      {localityOpen ? (
        <form className="radio-browse-controls__locality" onSubmit={submitLocality}>
          <label htmlFor="radio-browse-zip">Nearby radio <span>optional</span></label>
          <div>
            <input
              id="radio-browse-zip"
              value={zipDraft}
              onChange={(event) => setZipDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
              inputMode="numeric"
              maxLength={5}
              placeholder="US ZIP"
              aria-describedby="radio-browse-privacy"
            />
            <input
              value={cityDraft}
              onChange={(event) => setCityDraft(event.target.value)}
              maxLength={80}
              placeholder="City"
              aria-label="City"
            />
            <input
              value={regionDraft}
              onChange={(event) => setRegionDraft(event.target.value.replace(/[^a-z]/gi, "").slice(0, 2))}
              maxLength={2}
              placeholder="State"
              aria-label="US state"
            />
            <button type="submit" disabled={zipDraft.length !== 5 && !(cityDraft.trim() && regionDraft.length === 2)}>Save</button>
            {state.locality ? (
              <button type="button" onClick={clearLocality} aria-label="Clear locality"><X size={14} /></button>
            ) : null}
          </div>
          <p id="radio-browse-privacy">Only a coarse ZIP is retained on this device; it is not a profile or precise location.</p>
        </form>
      ) : null}

      <div className="radio-browse-controls__sort">
        <label htmlFor="radio-browse-sort">Sort</label>
        <select
          id="radio-browse-sort"
          value={state.sort}
          onChange={(event) => onStateChange(setRadioBrowseSort(state, event.target.value as RadioBrowseSort))}
        >
          {RADIO_BROWSE_SORTS
            .filter((sort) => sort === "recommended"
              || sort === "live-now"
              || sort === "name"
              || (state.lens === "local" && sort === "nearest")
              || (state.lens === "for-you" && (sort === "best-match" || sort === "rarest-crossing")))
            .map((sort) => <option value={sort} key={sort}>{SORT_LABELS[sort]}</option>)}
        </select>
      </div>

      {advancedOpen ? (
        <div className="radio-browse-controls__advanced">
          <fieldset>
            <legend>Station type</legend>
            <div className="radio-browse-controls__chips">
              {RADIO_BROWSE_STATION_TYPES.map((definition) => (
                <button
                  type="button"
                  key={definition.value}
                  className={filters.stationTypes.includes(definition.value) ? "is-active" : ""}
                  aria-pressed={filters.stationTypes.includes(definition.value)}
                  onClick={() => toggleFamily(state, "stationTypes", definition.value, "station-type", onStateChange)}
                >
                  {definition.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Specialist format</legend>
            <div className="radio-browse-controls__chips">
              {RADIO_BROWSE_FORMATS.map((definition) => (
                <button
                  type="button"
                  key={definition.value}
                  className={filters.specialistFormats.includes(definition.value) ? "is-active" : ""}
                  aria-pressed={filters.specialistFormats.includes(definition.value)}
                  onClick={() => toggleFamily(state, "specialistFormats", definition.value, "specialist-format", onStateChange)}
                >
                  {definition.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Station era tags</legend>
            <div className="radio-browse-controls__chips">
              {RADIO_BROWSE_DECADES.map((decade) => (
                <button
                  type="button"
                  key={decade}
                  className={filters.decades.includes(decade) ? "is-active" : ""}
                  aria-pressed={filters.decades.includes(decade)}
                  onClick={() => toggleFamily(state, "decades", decade as RadioBrowseDecade, "decade", onStateChange)}
                >
                  {decade}
                </button>
              ))}
            </div>
            <small>Explicit station tags only; this is not an inference from the track playing now.</small>
          </fieldset>
          <fieldset>
            <legend>Playing now</legend>
            <div className="radio-browse-controls__chips">
              {AGE_OPTIONS.map(({ value, label }) => (
                <button
                  type="button"
                  key={value}
                  className={filters.playingNow.includes(value) ? "is-active" : ""}
                  aria-pressed={filters.playingNow.includes(value)}
                  onClick={() => toggleFamily(state, "playingNow", value, "playing-now", onStateChange)}
                >
                  {label}
                </button>
              ))}
            </div>
            <small>Stations with unknown track age remain visible.</small>
          </fieldset>
          <fieldset>
            <legend>Bro Zones</legend>
            <div className="radio-browse-controls__chips">
              {BRO_ZONE_DEFINITIONS.map((zone) => (
                <button
                  type="button"
                  key={zone.key}
                  className={filters.broZones.includes(zone.key) ? "is-active" : ""}
                  aria-pressed={filters.broZones.includes(zone.key)}
                  onClick={() => toggleFamily(
                    state,
                    "broZones",
                    zone.key as BroZone,
                    "bro-zone",
                    onStateChange,
                  )}
                >
                  {zone.label}
                </button>
              ))}
            </div>
            <small>Reviewed station collection membership; locality does not infer a zone.</small>
          </fieldset>
          <label className="radio-browse-controls__check">
            <input
              type="checkbox"
              checked={filters.followedOnly}
              onChange={(event) => onStateChange(patchRadioBrowseFilters(state, { followedOnly: event.target.checked }))}
            />
            Followed stations only
          </label>
          <label className="radio-browse-controls__check">
            <input
              type="checkbox"
              checked={filters.supportOnly}
              onChange={(event) => onStateChange(patchRadioBrowseFilters(state, { supportOnly: event.target.checked }))}
            />
            Stations with support info
          </label>
        </div>
      ) : null}

      <nav className="radio-browse-controls__sounds" aria-label="Browse sounds">
        <span>Browse sounds</span>
        {RADIO_SOUND_DESTINATIONS.map((sound) => (
          <button
            type="button"
            key={sound.id}
            className={state.focusedSound === sound.id ? "is-active" : ""}
            aria-pressed={state.focusedSound === sound.id}
            onClick={() => {
              recordRadioBrowseEvent("sound_opened", { filterFamily: sound.kind });
              const selected = state.focusedSound === sound.id;
              onStateChange({
                ...state,
                focusedSound: selected ? null : sound.id,
                filters: selected
                  ? {
                    ...state.filters,
                    ...(sound.kind === "decade" ? { decades: [] } : { specialistFormats: [] }),
                  }
                  : sound.kind === "decade"
                    ? { ...state.filters, decades: [sound.id as RadioBrowseDecade] }
                    : { ...state.filters, specialistFormats: [sound.id as RadioBrowseFormat] },
                page: 1,
              });
            }}
          >
            {sound.label}
          </button>
        ))}
      </nav>
      {typeof resultCount === "number" ? <p className="radio-browse-controls__result" role="status">{resultCount} eligible stations</p> : null}
    </section>
  );
}