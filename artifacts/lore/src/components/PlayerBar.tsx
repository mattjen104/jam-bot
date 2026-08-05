import type { Station, NowPlaying } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import type {
  RadioCastStatus,
  RadioCastFallbackReason,
} from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { DevicePicker } from "./DevicePicker";
import {
  Cast,
  Loader2,
  Pause,
  Play,
  RotateCw,
  ScanLine,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

interface PlayerBarProps {
  station: Station;
  status: PlayerStatus;
  volume: number;
  error: string | null;
  casting?: RadioCastStatus;
  castFallbackReason?: RadioCastFallbackReason | null;
  castPaused?: boolean;
  onCastRetry?: () => void;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  spotify?: SpotifyConnectApi;
  nowPlaying?: NowPlaying | null;
  scanActive?: boolean;
  scanCurrent?: number;
  scanTotal?: number;
  onScanToggle?: () => void;
  scanDir?: 1 | -1;
  onScanDirToggle?: () => void;
}

export function PlayerBar({
  station,
  status,
  volume,
  error,
  casting = "off",
  castFallbackReason = null,
  castPaused = false,
  onCastRetry,
  onToggle,
  onStop,
  onVolume,
  nowPlaying,
  spotify,
  scanActive = false,
  scanCurrent = 1,
  scanTotal = 0,
  onScanToggle,
  scanDir = 1,
  onScanDirToggle,
}: PlayerBarProps) {
  const isCasting = casting === "casting";
  const isPlaying = isCasting ? !castPaused : status === "playing";
  const isLoading = !isCasting && status === "loading";
  const showDevicePicker = !!(spotify?.connected && spotify.premium);
  const showConnectPrompt = !!(spotify?.configured && !spotify.connected);
  const castDeviceName = spotify?.pinnedDevice?.name ?? "your Spotify";

  // Metadata for the ticker
  // Layout (top→bottom): song (dim) · album (mid) · artist (lime, most prominent)
  // Station name is already shown in the player-bar-info block above.
  const metaSong   = nowPlaying?.recording?.title   ?? nowPlaying?.rawTitle  ?? null;
  const metaArtist = nowPlaying?.recording?.artist  ?? nowPlaying?.rawArtist ?? null;
  const metaAlbum: string | null = null; // album title not yet in NowPlaying type

  // Status text for the secondary line
  const statusText = error
    ? error
    : scanActive
      ? `Scanning · ${scanCurrent} of ${scanTotal}`
      : isCasting
        ? (castPaused ? `Paused on ${castDeviceName}` : `Live · casting to ${castDeviceName}`)
        : casting === "connecting"
          ? "Waiting for a track…"
          : casting === "fallback"
            ? (castFallbackReason === "rate_limited"
                ? "Spotify rate-limited · playing broadcast"
                : castFallbackReason === "spotify_error"
                  ? "Spotify unavailable · playing broadcast"
                  : "Not on Spotify · playing broadcast")
            : isLoading
              ? "Buffering…"
              : null;

  return (
    <div className="player-bar-block" data-testid="player-bar">
      {/* ── Controls row ─────────────────────────────────────────────── */}
      <div className="player-bar-row">
        {/* EQ animation bars */}
        <span className="player-bar-eq" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="player-bar-eq__bar"
              style={{
                animationName: isPlaying ? "lore-eq" : undefined,
                animationDuration: "900ms",
                animationDelay: `${i * 120}ms`,
                animationIterationCount: "infinite",
                animationTimingFunction: "ease-in-out",
                transform: isPlaying ? undefined : "scaleY(0.3)",
              }}
            />
          ))}
        </span>

        {/* Station name + optional status */}
        <div className="player-bar-info">
          <span className="player-bar-station">{station.name}</span>
          {statusText && (
            <span className="player-bar-status">{statusText}</span>
          )}
        </div>

        {/* Right-side controls */}
        <div className="player-bar-controls">
          {/* Desktop-only: device picker + volume */}
          <div className="player-bar-desktop">
            {showDevicePicker && spotify ? (
              <DevicePicker spotify={spotify} />
            ) : showConnectPrompt && spotify ? (
              <button
                type="button"
                onClick={spotify.connect}
                className="player-bar-btn"
                aria-label="Connect Spotify"
                title="Connect Spotify to cast"
              >
                <Cast className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <div className="player-bar-vol">
              {volume === 0
                ? <VolumeX className="h-3.5 w-3.5" />
                : <Volume2 className="h-3.5 w-3.5" />}
              <input
                type="range"
                min={0} max={1} step={0.01}
                value={volume}
                onChange={(e) => onVolume(Number(e.target.value))}
                aria-label="Volume"
                data-testid="player-volume"
                className="player-bar-vol__range"
              />
            </div>
          </div>

          {/* Cast retry */}
          {casting === "fallback"
            && castFallbackReason !== "not_on_spotify"
            && onCastRetry && (
            <button
              type="button"
              onClick={onCastRetry}
              className="player-bar-btn"
              title="Retry Spotify"
              data-testid="cast-retry"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Scan direction flip (desktop) */}
          {scanActive && onScanDirToggle && (
            <button
              type="button"
              onClick={onScanDirToggle}
              className="player-bar-btn player-bar-btn--ghost"
              aria-label={scanDir === 1 ? "Scan backward" : "Scan forward"}
              title={scanDir === 1 ? "Scanning forward" : "Scanning backward"}
            >
              {scanDir === 1 ? "›" : "‹"}
            </button>
          )}

          {/* Play / pause */}
          <button
            type="button"
            onClick={() => onToggle(station)}
            aria-label={isPlaying ? "Pause" : "Play"}
            data-testid="player-toggle"
            className="player-bar-btn player-bar-btn--play"
          >
            {isLoading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : isPlaying
                ? <Pause className="h-3.5 w-3.5 fill-current" />
                : <Play className="h-3.5 w-3.5 fill-current ml-0.5" />}
          </button>

          {/* Scan */}
          {onScanToggle && (
            <button
              type="button"
              onClick={onScanToggle}
              aria-label={scanActive ? "Stop scan" : "Scan stations"}
              data-testid="player-scan"
              className={`player-bar-btn${scanActive ? " player-bar-btn--scan-on" : ""}`}
            >
              <ScanLine className="h-3.5 w-3.5" />
            </button>
          )}

          {/* Stop */}
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop and close player"
            data-testid="player-stop"
            className="player-bar-btn"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Ticker strip — 3-line car-radio track info ────────────────── */}
      {/* Row order: song (dim) · album (mid) · artist (lime, most prominent) */}
      <div className="player-ticker">
        <div className="player-ticker__meta">
          <div className="player-ticker__meta-line player-ticker__meta-song">
            {metaSong ?? "—"}
          </div>
          <div className="player-ticker__meta-line player-ticker__meta-artist">
            {metaAlbum ?? "—"}
          </div>
          <div className="player-ticker__meta-line player-ticker__meta-station">
            {metaArtist ?? "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
