import type { Station } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { Loader2, Pause, Play, Radio, Volume2, VolumeX, X } from "lucide-react";
import { KeepButton } from "./KeepButton";

interface PlayerBarProps {
  station: Station;
  status: PlayerStatus;
  volume: number;
  error: string | null;
  /** MBID of the currently-identified track, if resolved. */
  nowPlayingMbid?: string | null;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
}

export function PlayerBar({
  station,
  status,
  volume,
  error,
  nowPlayingMbid,
  onToggle,
  onStop,
  onVolume,
}: PlayerBarProps) {
  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  return (
    <div
      className="fixed z-40 border border-border bg-secondary/95 backdrop-blur-md shadow-lg
        bottom-4 left-4 right-4 rounded-[18px]
        lg:bottom-0 lg:left-[220px] lg:right-0 lg:rounded-none lg:shadow-none lg:border-x-0 lg:border-b-0"
      data-testid="player-bar"
    >
      {/*
        Mobile: flex row — [play] [info flex-1] [volume+stop]
        Desktop (lg): 3-column grid — [info] [play centered] [volume+stop right-aligned]
      */}
      <div className="flex items-center gap-4 px-5 py-3 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
        {/* Station logo swatch — mobile only, violet border treatment */}
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-primary/25 bg-primary/10 lg:hidden">
          {station.logoUrl ? (
            <img src={station.logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Radio className="h-4 w-4 text-primary/60" />
            </div>
          )}
        </div>

        {/* Play/pause button — mobile: second; desktop: center column (lg:order-2) */}
        <button
          type="button"
          onClick={() => onToggle(station)}
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="player-toggle"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary text-primary-foreground transition-transform active:scale-95 lg:order-2 lg:mx-auto"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="ml-0.5 h-4 w-4 fill-current" />
          )}
        </button>

        {/* Station info — mobile: middle (flex-1); desktop: left column */}
        <div className="min-w-0 flex-1 lg:order-1">
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
          <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
            {error ? (
              error
            ) : isLoading ? (
              "Buffering the live stream…"
            ) : isPlaying ? (
              <>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                  aria-hidden
                />
                Live · playing unmodified from source
              </>
            ) : (
              "Paused"
            )}
          </p>
        </div>

        {/* Controls — mobile: rightmost; desktop: right column (flex justify-end) */}
        <div className="flex shrink-0 items-center gap-2 lg:order-3 lg:justify-end">
          {/* Compact Keep — shown whenever a track is identified */}
          {nowPlayingMbid && (
            <KeepButton
              mbid={nowPlayingMbid}
              compact
              provenance={{ kind: "keep", stationSlug: station.slug }}
            />
          )}
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
    </div>
  );
}
