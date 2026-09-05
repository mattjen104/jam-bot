/**
 * StationFinderSheet — search the worldwide Radio Browser directory and pin
 * stations to the listener's personal, device-local station list.
 *
 * Opened from the "Find stations" button in the SplitHome radio remote.
 * Queries the API server's Radio Browser proxy (GET /api/stations/search),
 * shows each result with location / genre tags / stream quality, offers a
 * 10-second live preview, and pins via the localStorage-backed
 * useAddedStations store. Stations already in the curated Lore catalog show
 * an "Already in Lore" label instead of an Add button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Play, Plus, Search, Square, X } from "lucide-react";
import { useAddedStations } from "../hooks/useAddedStations";
import {
  qualityLabel,
  streamFormatForCodec,
  type AddedStation,
} from "../lib/addedStations";

const API = "/api";
const DEBOUNCE_MS = 400;
const PREVIEW_MS = 10_000;
const MIN_QUERY_LEN = 2;

function stationResultKey(station: StationSearchResult): string {
  return station.resultId ?? station.radioBrowserUuid ?? station.name;
}

/** Trimmed result shape returned by GET /api/stations/search. */
export interface StationSearchResult {
  resultId: string;
  source: "catalog" | "radio_browser";
  catalogStationId: number | null;
  name: string;
  city: string | null;
  state: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
  locationConfidence: "verified" | "directory" | "coarse" | null;
  approximateDistanceMiles: number | null;
  tags: string[];
  url: string;
  favicon: string | null;
  bitrate: number | null;
  codec: string | null;
  radioBrowserUuid: string | null;
  inLoreCatalog: boolean;
}

export interface StationFinderSheetProps {
  onClose: () => void;
}

export function StationFinderSheet({ onClose }: StationFinderSheetProps) {
  const { addedStations, addStation, removeStation, isAdded } = useAddedStations();

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "nearby">("search");
  const [zip, setZip] = useState("");
  const [radiusMiles, setRadiusMiles] = useState("50");
  const [nearbyLabel, setNearbyLabel] = useState<string | null>(null);
  const [country, setCountry] = useState("");
  const [tag, setTag] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<StationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [previewingUuid, setPreviewingUuid] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const changeMode = useCallback((nextMode: "search" | "nearby") => {
    searchAbortRef.current?.abort();
    searchAbortRef.current = null;
    setMode(nextMode);
    setResults([]);
    setSearching(false);
    setSearchError(null);
    setNearbyLabel(null);
  }, []);

  const runNearbySearch = useCallback(() => {
    searchAbortRef.current?.abort();
    const ctrl = new AbortController();
    searchAbortRef.current = ctrl;
    setSearching(true);
    setSearchError(null);
    setNearbyLabel(null);
    setResults([]);
    const params = new URLSearchParams({ zip: zip.trim(), radiusMiles });
    fetch(`${API}/stations/nearby?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const msg =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Nearby search failed (${res.status})`;
          throw new Error(msg);
        }
        return body as {
          origin: { city: string; region: string };
          results: StationSearchResult[];
          directoryStatus: "available" | "unavailable";
        };
      })
      .then((data) => {
        setNearbyLabel(`${data.origin.city}, ${data.origin.region}`);
        setResults(data.results);
        if (data.directoryStatus === "unavailable" && data.results.length === 0) {
          setSearchError("The station directory is temporarily unavailable.");
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : "Nearby search failed.");
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setSearching(false);
      });
  }, [radiusMiles, zip]);

  // Debounce the three search fields together (400 ms), then search the
  // Radio Browser proxy. All state writes happen inside the timeout / fetch
  // callbacks — never synchronously in the effect body.
  useEffect(() => {
    if (mode !== "search") return;
    const t = setTimeout(() => {
      const q = query.trim();
      setDebouncedQuery(q);
      if (q.length < MIN_QUERY_LEN) {
        setResults([]);
        setSearching(false);
        setSearchError(null);
        return;
      }
      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setSearching(true);
      setSearchError(null);
      const params = new URLSearchParams({ q });
      const c = country.trim();
      const g = tag.trim();
      if (c) params.set("country", c);
      if (g) params.set("tag", g);
      fetch(`${API}/stations/search?${params}`, { signal: ctrl.signal })
        .then(async (res) => {
          if (!res.ok) {
            const body: unknown = await res.json().catch(() => null);
            const msg =
              body && typeof body === "object" && "error" in body && typeof body.error === "string"
                ? body.error
                : `Search failed (${res.status})`;
            throw new Error(msg);
          }
          return (await res.json()) as { results: StationSearchResult[] };
        })
        .then((data) => setResults(data.results))
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setResults([]);
          setSearchError(err instanceof Error ? err.message : "Search failed.");
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, country, tag, mode]);

  // Autofocus the search box when the sheet opens.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const stopPreview = useCallback(() => {
    if (previewTimerRef.current != null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      audioRef.current = null;
    }
    setPreviewingUuid(null);
  }, []);

  const startPreview = useCallback(
    (station: StationSearchResult) => {
      stopPreview();
      if (typeof Audio === "undefined") return;
      const el = new Audio(station.url);
      el.preload = "none";
      audioRef.current = el;
      setPreviewingUuid(stationResultKey(station));
      el.addEventListener("error", stopPreview);
      void el.play().catch(stopPreview);
      // A preview is a 10-second sample — never leave a stream running.
      previewTimerRef.current = setTimeout(stopPreview, PREVIEW_MS);
    },
    [stopPreview],
  );

  const togglePreview = useCallback(
    (station: StationSearchResult) => {
      if (previewingUuid === stationResultKey(station)) stopPreview();
      else startPreview(station);
    },
    [previewingUuid, startPreview, stopPreview],
  );

  // Close on Escape; stop any preview when the sheet unmounts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current != null) clearTimeout(previewTimerRef.current);
      audioRef.current?.pause();
    };
  }, []);

  const pinStation = useCallback(
    (r: StationSearchResult) => {
      if (!r.radioBrowserUuid) return;
      const station: AddedStation = {
        radioBrowserUuid: r.radioBrowserUuid,
        name: r.name,
        streamUrl: r.url,
        streamFormat: streamFormatForCodec(r.codec, r.url),
        faviconUrl: r.favicon,
        state: r.state,
        city: r.city,
        region: r.region,
        country: r.country,
        latitude: r.latitude,
        longitude: r.longitude,
        locationSource: r.locationSource,
        locationConfidence: r.locationConfidence,
        tags: r.tags,
        bitrate: r.bitrate,
        codec: r.codec,
        addedAt: new Date().toISOString(),
      };
      addStation(station);
    },
    [addStation],
  );

  const showPrompt = mode === "search"
    ? debouncedQuery.length < MIN_QUERY_LEN
    : !searching && nearbyLabel === null && searchError === null;

  return (
    <div className="sfinder-overlay" role="dialog" aria-modal="true" aria-label="Find stations">
      <div className="sfinder-sheet">
        {/* ── Header: search input + narrow filters ──────────────────── */}
        <div className="sfinder-header">
          <div className="sfinder-tabs" role="tablist" aria-label="Station search type">
            <button type="button" role="tab" aria-selected={mode === "search"} onClick={() => changeMode("search")}>Search</button>
            <button type="button" role="tab" aria-selected={mode === "nearby"} onClick={() => changeMode("nearby")}>Near me</button>
          </div>
          <button
            type="button"
            className="sfinder-close"
            onClick={onClose}
            aria-label="Close station finder"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
        {mode === "search" ? <>
          <div className="sfinder-searchline">
            <Search className="sfinder-icon" size={14} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              className="sfinder-input"
              placeholder="Station name, call sign, or city…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Search the Radio Browser directory"
            />
          </div>
          <div className="sfinder-filters">
          <input
            type="text"
            className="sfinder-filter"
            placeholder="Country (optional)"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Filter by country"
          />
          <input
            type="text"
            className="sfinder-filter"
            placeholder="Genre / tag (optional)"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Filter by genre or tag"
          />
          </div>
        </> : (
          <form className="sfinder-nearby" onSubmit={(event) => { event.preventDefault(); runNearbySearch(); }}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              className="sfinder-filter"
              placeholder="5-digit US ZIP"
              value={zip}
              onChange={(event) => setZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
              aria-label="US ZIP code"
              required
            />
            <select className="sfinder-filter" value={radiusMiles} onChange={(event) => setRadiusMiles(event.target.value)} aria-label="Search radius">
              {[25, 50, 100, 250].map((radius) => <option key={radius} value={radius}>{radius} miles</option>)}
            </select>
            <button type="submit" className="sfinder-btn" disabled={searching || zip.length !== 5}>
              {searching ? "Finding…" : "Find stations"}
            </button>
            <span className="sfinder-privacy">Used for this search only. Not saved.</span>
          </form>
        )}

        <div className="sfinder-body">
          {/* ── My stations ───────────────────────────────────────────── */}
          {addedStations.length > 0 && (
            <section className="sfinder-group" aria-label="My stations">
              <div className="sfinder-grp-lbl">My stations</div>
              <ul className="sfinder-list">
                {addedStations.map((s) => (
                  <li key={s.radioBrowserUuid} className="sfinder-row">
                    <div className="sfinder-row__body">
                      <span className="sfinder-row__name">{s.name}</span>
                      <span className="sfinder-row__sub">
                        {[s.state, s.country].filter(Boolean).join(" · ")}
                        {qualityLabel(s.bitrate, s.codec) ? ` · ${qualityLabel(s.bitrate, s.codec)}` : ""}
                      </span>
                    </div>
                    <div className="sfinder-row__actions">
                      <button
                        type="button"
                        className="sfinder-btn"
                        onClick={() => removeStation(s.radioBrowserUuid)}
                        aria-label={`Remove ${s.name} from my stations`}
                      >
                        Remove + unfollow
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Search results ────────────────────────────────────────── */}
          {showPrompt && (
            <div className="sfinder-empty">
              {mode === "search"
                ? <>Search the worldwide Radio Browser directory — try your city, a station call sign, or a genre. Pinned stations are stored only on this device.</>
                : <>Enter a US ZIP to find stations based nearby. Distances are approximate straight-line distances, not reception coverage. Your ZIP is not saved.</>}
            </div>
          )}

          {!showPrompt && searching && results.length === 0 && (
            <div className="sfinder-empty" aria-busy="true">
              <Loader2 size={12} className="sfinder-spin" aria-hidden="true" /> Searching…
            </div>
          )}

          {!showPrompt && !searching && searchError && (
            <div className="sfinder-empty" role="alert">{searchError}</div>
          )}

          {!showPrompt && !searching && !searchError && results.length === 0 && (
            <div className="sfinder-empty">
              {mode === "nearby"
                ? <>No stations with usable location evidence are based within {radiusMiles} miles of <em>{nearbyLabel}</em>.</>
                : <>No stations found for <em>"{debouncedQuery}"</em></>}
            </div>
          )}

          {results.length > 0 && (
            <section className="sfinder-group" aria-label="Search results">
              <div className="sfinder-grp-lbl">
                {searching ? "Results (updating…)" : "Results"}
              </div>
              <ul className="sfinder-list">
                {results.map((r, index) => {
                  const added = r.radioBrowserUuid ? isAdded(r.radioBrowserUuid) : false;
                  const resultKey = stationResultKey(r) || `${r.name}-${index}`;
                  const previewing = previewingUuid === resultKey;
                  return (
                    <li key={resultKey} className="sfinder-row">
                      <div className="sfinder-row__body">
                        <span className="sfinder-row__name">{r.name}</span>
                        <span className="sfinder-row__sub">
                          {mode === "nearby" ? "Based in " : ""}
                          {(mode === "nearby"
                            ? [r.city, r.region ?? r.state, r.country].filter(Boolean).join(", ")
                            : [r.state, r.country].filter(Boolean).join(" · "))}
                          {r.approximateDistanceMiles != null ? ` · approximately ${r.approximateDistanceMiles} miles away` : ""}
                          {qualityLabel(r.bitrate, r.codec) ? ` · ${qualityLabel(r.bitrate, r.codec)}` : ""}
                        </span>
                        {r.tags.length > 0 && (
                          <span className="sfinder-row__tags">{r.tags.slice(0, 4).join(" · ")}</span>
                        )}
                      </div>
                      <div className="sfinder-row__actions">
                        <button
                          type="button"
                          className="sfinder-btn sfinder-btn--icon"
                          onClick={() => togglePreview(r)}
                          aria-label={previewing ? `Stop preview of ${r.name}` : `Preview ${r.name} (10 seconds)`}
                          aria-pressed={previewing}
                        >
                          {previewing
                            ? <Square size={11} aria-hidden="true" />
                            : <Play size={11} aria-hidden="true" />}
                          {previewing ? "Stop" : "Preview"}
                        </button>
                        {r.inLoreCatalog ? (
                          <span className="sfinder-inlore">Already in Lore</span>
                        ) : added ? (
                          <button
                            type="button"
                            className="sfinder-btn sfinder-btn--added"
                            onClick={() => r.radioBrowserUuid && removeStation(r.radioBrowserUuid)}
                            aria-label={`Remove ${r.name} from my stations`}
                            aria-pressed="true"
                          >
                            <Check size={11} aria-hidden="true" /> Added
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sfinder-btn"
                            onClick={() => pinStation(r)}
                            aria-label={`Add ${r.name} to my stations`}
                          >
                            <Plus size={11} aria-hidden="true" /> Add
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
