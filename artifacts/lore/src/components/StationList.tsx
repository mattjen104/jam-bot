import type { Station } from "@workspace/api-client-react";
import { QualityBadge } from "./QualityBadge";
import { Pause, Play, Radio } from "lucide-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";

interface StationListProps {
  stations: Station[];
  activeSlug: string | null;
  status: PlayerStatus;
  onToggle: (station: Station) => void;
  onSelect: (station: Station) => void;
}

export function StationList({
  stations,
  activeSlug,
  status,
  onToggle,
  onSelect,
}: StationListProps) {
  return (
    <ul className="flex flex-col gap-2" data-testid="station-list">
      {stations.map((station) => {
        const isActive = station.slug === activeSlug;
        const isPlaying = isActive && status === "playing";
        const isLoading = isActive && status === "loading";
        return (
          <li key={station.slug}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(station)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(station);
                }
              }}
              data-testid={`station-${station.slug}`}
              className={`hover-elevate group flex items-center gap-4 rounded-xl border p-3 pr-4 transition-colors ${
                isActive
                  ? "border-primary-border bg-primary/[0.06]"
                  : "border-card-border bg-card"
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(station);
                }}
                aria-label={isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
                data-testid={`toggle-${station.slug}`}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95"
              >
                {isLoading ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                ) : isPlaying ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
                    {station.name}
                  </h3>
                  {isPlaying && (
                    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="lore-eq-bar w-[2px] bg-primary"
                          style={{ height: "12px", animationDelay: `${i * 140}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                  <Radio className="h-3 w-3" />
                  {[station.org, station.country].filter(Boolean).join(" · ") ||
                    "Independent"}
                </p>
              </div>

              <div className="shrink-0">
                <QualityBadge quality={station.streamQuality} format={station.streamFormat} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
