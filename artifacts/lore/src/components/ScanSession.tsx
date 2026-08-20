import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { CrossingScope } from "../lib/crossingScope";
import type { StationCategory } from "../lib/dialCategories";
import type { Station } from "@workspace/api-client-react";
import type { DialSpin } from "../hooks/useDialData";
import { HistoryScanner } from "./dial/HistoryScanner";
import { CategoryScanLane } from "./dial/CategoryScanLane";
import { usePlayer } from "../player/PlayerProvider";

export type ScanSource = "live" | "archive";

export interface ScanSessionProps {
  scope: CrossingScope;
  categories: readonly StationCategory[];
  stationSlug?: string | null;
  stationName?: string | null;
  liveStations?: Station[];
  liveNowPlayingBySlug?: Map<string, DialSpin>;
  activeStationSlug?: string | null;
  onTuneStation?: (slug: string) => void;
  onClose: () => void;
}

/**
 * The single listener-facing scan surface. Playback stays owned by the
 * existing player/scanner implementations; this component owns only the
 * selection contract and the calm, shared presentation around them.
 */
export function ScanSession({
  scope,
  categories,
  stationSlug = null,
  stationName = null,
  liveStations = [],
  liveNowPlayingBySlug = new Map(),
  activeStationSlug = null,
  onTuneStation,
  onClose,
}: ScanSessionProps) {
  const [source, setSource] = useState<ScanSource>("archive");
  const [filter, setFilter] = useState<"all" | "crossings" | "firstPlays">("all");
  const { scan } = usePlayer();

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
            <p className="scan-session__summary">
              {source === "live" ? "Live stations" : "Archive"}
              {stationName ? ` · ${stationName}` : " · across Lore"}
              {" · "}
              {filter === "firstPlays" ? "first plays" : filter}
            </p>
          </div>
          <button type="button" className="scan-session__close" onClick={onClose} aria-label="Close Scan">
            <X size={18} />
          </button>
        </header>

        <div className="scan-session__choices" role="group" aria-label="Scan source">
          <button type="button" aria-pressed={source === "live"} onClick={() => setSource("live")}>
            Live stations
          </button>
          <button type="button" aria-pressed={source === "archive"} onClick={() => setSource("archive")}>
            Archive
          </button>
        </div>
        <div className="scan-session__choices" role="group" aria-label="Archive filter">
          {(["all", "crossings", "firstPlays"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {value === "firstPlays" ? "First plays" : value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>

        {source === "archive" ? (
          <HistoryScanner
            key={`${stationSlug ?? "all"}-${filter}`}
            scope={scope}
            categories={categories}
            stationSlug={stationSlug}
            initialFilter={filter}
            onFilterChange={setFilter}
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