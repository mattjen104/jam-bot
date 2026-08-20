import { useEffect } from "react";
import { X } from "lucide-react";
import type { CrossingScope } from "../lib/crossingScope";
import type { StationCategory } from "../lib/dialCategories";
import type { Station } from "@workspace/api-client-react";
import type { DialSpin } from "../hooks/useDialData";
import { HistoryScanner } from "./dial/HistoryScanner";
import { CategoryScanLane } from "./dial/CategoryScanLane";
import { usePlayer } from "../player/PlayerProvider";
import { STATION_CATEGORY_DEFINITIONS } from "../lib/dialCategories";

export type ScanSource = "live" | "archive";
export type ScanFilter = "all" | "crossings" | "firstPlays";

export interface ScanSessionProps {
  scope: CrossingScope;
  categories: readonly StationCategory[];
  source: ScanSource;
  filter: ScanFilter;
  onSourceChange: (source: ScanSource) => void;
  onFilterChange: (filter: ScanFilter) => void;
  stationSlug?: string | null;
  stationName?: string | null;
  liveStations?: Station[];
  liveNowPlayingBySlug?: Map<string, DialSpin>;
  activeStationSlug?: string | null;
  onTuneStation?: (slug: string) => void;
  onClose: () => void;
}

const FILTER_LABELS: Record<ScanFilter, string> = {
  all: "All",
  crossings: "Crossings",
  firstPlays: "First plays",
};
/**
 * The single listener-facing scan surface. Playback stays owned by the
 * existing player/scanner implementations; this component owns only the
 * selection contract and the calm, shared presentation around them.
 */
export function ScanSession({
  scope,
  categories,
  source,
  filter,
  onSourceChange,
  onFilterChange,
  stationSlug = null,
  stationName = null,
  liveStations = [],
  liveNowPlayingBySlug = new Map(),
  activeStationSlug = null,
  onTuneStation,
  onClose,
}: ScanSessionProps) {
  const { scan, ride } = usePlayer();
  const selection = selectionLabel(stationName, categories);
  const filterLabel = FILTER_LABELS[filter];
  const focusedStation = activeStationSlug
    ? liveStations.find((station) => station.slug === activeStationSlug)?.name ?? null
    : null;
  const historyRide = ride.active && ride.replayLabel?.startsWith("History scan");
  const status = source === "live"
    ? focusedStation
      ? `Focused on ${focusedStation}`
      : scan.active
        ? "Scanning"
        : scan.current
          ? "Paused"
          : "Ready"
    : historyRide
      ? ride.status === "paused"
        ? "Paused"
        : "Scanning"
      : "Ready";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="scan-session" role="dialog" aria-modal="true" aria-labelledby="scan-session-title">
      <div className="scan-session__panel">
        <header className="scan-session__header">
          <div>
            <p className="scan-session__eyebrow">Discovery session</p>
            <h2 id="scan-session-title">Scan</h2>
            <p className="scan-session__summary" data-testid="scan-selection-summary">
              <span>{source === "live" ? "Live" : "Archive"}</span>
              <span aria-hidden="true"> · </span>
              <span>{selection}</span>
              <span aria-hidden="true"> · </span>
              <span>{filterLabel}</span>
            </p>
            <p className="scan-session__status" role="status" aria-live="polite">{status}</p>
          </div>
          <button type="button" className="scan-session__close" onClick={onClose} aria-label="Close Scan">
            <X size={18} />
          </button>
        </header>

        <div className="scan-session__choices scan-session__choices--source" role="group" aria-label="Scan source">
          <button type="button" aria-pressed={source === "live"} onClick={() => onSourceChange("live")}>
            Live stations
          </button>
          <button type="button" aria-pressed={source === "archive"} onClick={() => onSourceChange("archive")}>
            Archive
          </button>
        </div>
        {source === "archive" && (
          <div className="scan-session__choices scan-session__choices--filters" role="group" aria-label="Archive filter">
            {(["all", "crossings", "firstPlays"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}>
                {FILTER_LABELS[value]}
              </button>
            ))}
          </div>
        )}

        {source === "archive" ? (
          <HistoryScanner
            key={`${stationSlug ?? "all"}-${filter}`}
            scope={scope}
            categories={categories}
            stationSlug={stationSlug}
            initialFilter={filter}
            onFilterChange={onFilterChange}
          />
        ) : (
          <div className="scan-session__live" role="status" aria-live="polite">
            <strong>{scan.active ? "Scanning live stations" : "Live station scan"}</strong>
            <p>
              {scan.current
                ? `${scan.current.artist} · ${scan.current.stationName}`
                : "The live stream stays live while Scan updates around it."}
            </p>
            <div className="scan-session__transport" role="group" aria-label="Live scan controls">
              <button type="button" onClick={scan.toggle} aria-pressed={scan.active}>
                {scan.active ? "Stop live scan" : "Start live scan"}
              </button>
              {scan.active && (
                <button type="button" onClick={scan.toggleDir} aria-label="Change scan direction">
                  {scan.dir === 1 ? "Forward" : "Reverse"}
                </button>
              )}
            </div>
            {liveStations.length > 0 && onTuneStation && (
              <>
                <div className="scan-session__focus">
                  <h3>Focus a station</h3>
                  <div className="scan-session__station-list" role="group" aria-label="Live station focus">
                    {liveStations.map((station) => {
                      const now = liveNowPlayingBySlug.get(station.slug);
                      const isActive = activeStationSlug === station.slug;
                      return (
                        <button
                          key={station.slug}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() => onTuneStation(station.slug)}
                        >
                          <span>{station.name}</span>
                          <small>{now?.artist ? `${now.artist} · ${now.title}` : "Quiet right now"}</small>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="scan-session__focus">
                  <h3>Focus a category</h3>
                  <CategoryScanLane
                    stations={liveStations}
                    nowPlayingBySlug={liveNowPlayingBySlug}
                    activeSlug={activeStationSlug}
                    onTuneIn={onTuneStation}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ScanEntryButton({ onOpen, compact = false }: { onOpen: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      className={`scan-entry${compact ? " scan-entry--compact" : ""}`}
      onClick={onOpen}
      aria-label="Open Scan"
      data-testid="scan-entry"
    >
      Scan
    </button>
  );
}

function selectionLabel(
  stationName: string | null | undefined,
  categories: readonly StationCategory[],
): string {
  if (stationName) return `Station: ${stationName}`;
  if (categories.length === 0) return "All Lore";
  const labels = categories.map(
    (category) => STATION_CATEGORY_DEFINITIONS.find((definition) => definition.cat === category)?.label ?? category,
  );
  return `${labels.length === 1 ? "Category" : "Categories"}: ${labels.join(", ")}`;
}
