import { useEffect } from "react";
import type { Station, StationNowPlaying } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { NowPlaying } from "./NowPlaying";
import {
  ChevronDown,
  Loader2,
  Pause,
  Play,
  ScanLine,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

interface PlayerSheetProps {
  station: Station;
  nowPlayingData: StationNowPlaying | undefined;
  status: PlayerStatus;
  volume: number;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  scanActive?: boolean;
  onScanToggle?: () => void;
  onCollapse: () => void;
}

/**
 * Expanded now-playing sheet — the Spotify-style full-screen view opened by
 * tapping the mini player. Reuses the existing NowPlaying card (artwork,
 * track/artist, knowledge panels) plus a full player-control row; a chevron
 * collapses back to the mini player. Playback state lives in the provider —
 * this surface only renders and forwards the same actions the dock uses.
 */
export function PlayerSheet({
  station,
  nowPlayingData,
  status,
  volume,
  onToggle,
  onStop,
  onVolume,
  scanActive = false,
  onScanToggle,
  onCollapse,
}: PlayerSheetProps) {
  const isPlaying = status === "playing";
  const isLoading = status === "loading";

  // Escape collapses, matching the sheet convention elsewhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCollapse]);

  return (
    <div
      className="player-sheet"
      role="dialog"
      aria-label={`Now playing — ${station.name}`}
      data-testid="player-sheet"
    >
      <div className="player-sheet__head">
        <button
          type="button"
          className="player-sheet__collapse"
          onClick={onCollapse}
          aria-label="Collapse player"
          data-testid="player-sheet-collapse"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        <span className="player-sheet__head-label">Now playing</span>
        <span className="player-sheet__head-spacer" aria-hidden="true" />
      </div>

      <div className="player-sheet__body">
        <NowPlaying
          data={nowPlayingData}
          isLoading={!nowPlayingData}
          fallbackStation={station}
        />
      </div>

      {/* Full player controls — same actions as the mini player. */}
      <div className="player-sheet__controls" data-testid="player-sheet-controls">
        <div className="player-sheet__vol">
          {volume === 0
            ? <VolumeX className="h-4 w-4" />
            : <Volume2 className="h-4 w-4" />}
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            aria-label="Volume"
            data-testid="player-sheet-volume"
            className="player-bar-vol__range"
          />
        </div>
        <button
          type="button"
          onClick={() => onToggle(station)}
          aria-label={isPlaying ? "Pause" : "Play"}
          data-testid="player-sheet-toggle"
          className="player-bar-btn player-bar-btn--play player-sheet__btn"
        >
          {isLoading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : isPlaying
              ? <Pause className="h-4 w-4 fill-current" />
              : <Play className="h-4 w-4 fill-current ml-0.5" />}
        </button>
        {onScanToggle && (
          <button
            type="button"
            onClick={onScanToggle}
            aria-label={scanActive ? "Stop scan" : "Scan stations"}
            data-testid="player-sheet-scan"
            className={`player-bar-btn player-sheet__btn${scanActive ? " player-bar-btn--scan-on" : ""}`}
          >
            <ScanLine className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop and close player"
          data-testid="player-sheet-stop"
          className="player-bar-btn player-sheet__btn"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
