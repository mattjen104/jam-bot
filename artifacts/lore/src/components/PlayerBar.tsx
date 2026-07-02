import type { Station } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { Loader2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";

interface PlayerBarProps {
  station: Station;
  status: PlayerStatus;
  volume: number;
  error: string | null;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
}

export function PlayerBar({
  station,
  status,
  volume,
  error,
  onToggle,
  onStop,
  onVolume,
}: PlayerBarProps) {
  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md"
      data-testid="player-bar"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => onToggle(station)}
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="player-toggle"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-3 items-end gap-[2px]" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-[2px] bg-primary"
                  style={{
                    height: "12px",
                    transformOrigin: "bottom",
                    animation: isPlaying
                      ? `lore-eq 900ms ease-in-out ${i * 120}ms infinite`
                      : "none",
                    transform: isPlaying ? undefined : "scaleY(0.3)",
                  }}
                />
              ))}
            </span>
            <p className="truncate font-serif text-base font-semibold text-foreground">
              {station.name}
            </p>
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {error
              ? error
              : isLoading
                ? "Buffering the live stream…"
                : isPlaying
                  ? "Live · playing unmodified from source"
                  : "Paused"}
          </p>
        </div>

        <div className="hidden items-center gap-2 sm:flex">
          {volume === 0 ? (
            <VolumeX className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          )}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="Volume"
            data-testid="player-volume"
            className="h-1 w-24 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
          />
        </div>

        <button
          type="button"
          onClick={onStop}
          aria-label="Stop and close player"
          data-testid="player-stop"
          className="hover-elevate flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
