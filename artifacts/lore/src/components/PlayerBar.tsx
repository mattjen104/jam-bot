import type { Station, NowPlaying } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { resolvePlaybackSource } from "../hooks/useRadioPlayer";
import { safeHttpUrl } from "../lib/utils";
import type {
  RadioCastStatus,
  RadioCastFallbackReason,
} from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { DevicePicker } from "./DevicePicker";
import { KeepButton } from "./KeepButton";
import type { ScanHop } from "../player/PlayerProvider";
import { LiveHandoffPanel, type LiveHandoffControls } from "./LiveHandoffPanel";
import { LandingConfirmationNote } from "./dial/LandingConfirmationNote";
import type { LandingConfirmation } from "../hooks/useStationFastLane";
import {
  Cast,
  ExternalLink,
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
  onRetry?: () => void;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  spotify?: SpotifyConnectApi;
  nowPlaying?: NowPlaying | null;
  /**
   * Provisional now-playing from the SSE spin-raw fast path: the raw
   * artist/title of a just-detected track, shown while resolution (and the
   * 30s REST poll) catch up. `resolving` is true until the resolved
   * spin-changed frame arrives — render a subtle cue rather than full
   * confidence.
   */
  provisionalNowPlaying?: { artist: string; title: string; resolving: boolean } | null;
  scanActive?: boolean;
  scanCurrent?: ScanHop | null;
  onScanToggle?: () => void;
  scanDir?: 1 | -1;
  onScanDirToggle?: () => void;
  /** Tap-to-expand: fired when the bar surface (not a control) is tapped. */
  onExpand?: () => void;
  handoff?: LiveHandoffControls;
  landingConfirmation?: LandingConfirmation | null;
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
  onRetry,
  onToggle,
  onStop,
  onVolume,
  nowPlaying,
  provisionalNowPlaying = null,
  spotify,
  scanActive = false,
  scanCurrent = null,
  onScanToggle,
  scanDir = 1,
  onScanDirToggle,
  onExpand,
  handoff,
  landingConfirmation = null,
}: PlayerBarProps) {
  const isCasting = casting === "casting";
  const isPlaying = isCasting ? !castPaused : status === "playing";
  const isLoading =
    !isCasting &&
    (status === "loading" ||
      status === "reconnecting" ||
      status === "recovering");
  const showDevicePicker = !!(spotify?.connected && spotify.premium);
  const showConnectPrompt = !!(spotify?.configured && !spotify.connected);
  const castDeviceName = spotify?.pinnedDevice?.name ?? "your Spotify";
  const homepageUrl = safeHttpUrl(station.homepageUrl);

  // Metadata for the ticker
  // Layout (top→bottom): song (dim) · album (mid) · artist (lime, most prominent)
  // Station name is already shown in the player-bar-info block above.
  const metaSong   = scanActive && scanCurrent
    ? scanCurrent.title
    : provisionalNowPlaying?.title  ?? nowPlaying?.recording?.title   ?? nowPlaying?.rawTitle  ?? null;
  const metaArtist = scanActive && scanCurrent
    ? scanCurrent.artist
    : provisionalNowPlaying?.artist ?? nowPlaying?.recording?.artist  ?? nowPlaying?.rawArtist ?? null;
  const metaAlbum: string | null = null; // album title not yet in NowPlaying type
  // Subtle cue while a provisional track is still resolving — dim the
  // provisional text so it never reads with full confidence.
  const metaResolving = provisionalNowPlaying?.resolving === true;

  // Status text for the secondary line
  const statusText = scanActive
      ? `Preview scan · ${scanCurrent?.category ?? "new music"} · ${scanCurrent?.stationName ?? "loading"}`
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
            : status === "recovering"
              ? "Trying alternate stream…"
              : status === "reconnecting"
                ? "Reconnecting…"
                : status === "loading"
                  ? "Buffering…"
                  : error;

  return (
    <div className="player-bar-block" data-testid="player-bar">
      {/* ── Controls row ─────────────────────────────────────────────── */}
      {/* Tapping anywhere on the row EXCEPT a control (button/input/link)
          expands the full now-playing sheet on mobile. Controls keep working
          without expanding — the closest() guard swallows nothing. */}
      <div
        className="player-bar-row"
        data-testid="player-bar-surface"
        onClick={
          onExpand
            ? (e) => {
                const el = e.target as HTMLElement;
                if (el.closest("button, input, a, [role='slider']")) return;
                onExpand();
              }
            : undefined
        }
      >
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
          {/* Phone widths: one quiet line — station · current track. The
              stacked ticker below is CSS-hidden at the same breakpoint. */}
          {(metaArtist || metaSong) && (
            <span
              className="player-bar-mobiletrack"
              style={metaResolving ? { opacity: 0.6 } : undefined}
              title={metaResolving ? "New track just detected — details still resolving" : undefined}
              data-testid={metaResolving ? "player-bar-resolving" : undefined}
            >
              {" · "}{[metaArtist, metaSong].filter(Boolean).join(" — ")}
            </span>
          )}
          {statusText && (
            <span
              className="player-bar-status"
              role="status"
              aria-live="polite"
              data-testid={
                status === "reconnecting" || status === "recovering"
                  ? "player-recovery-status"
                  : undefined
              }
            >
              {statusText}
            </span>
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

          {status === "error" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="player-bar-btn"
              title="Retry live stream"
              aria-label="Retry live stream"
              data-testid="player-retry"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
          )}

          {status === "error" && homepageUrl && (
            <a
              href={homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="player-bar-btn station-site-link player-bar-site-link"
              title={`Listen on ${station.name} site`}
              aria-label={`Listen on ${station.name} site`}
              data-testid="player-error-site-link"
            >
              <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
            </a>
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

          {/* Play / pause — replaced by site link for attribution-only stations */}
          {resolvePlaybackSource(station) != null ? (
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
          ) : homepageUrl ? (
            <a
              href={homepageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="player-bar-btn station-site-link player-bar-site-link"
              title={`Open ${station.name} site`}
              aria-label={`Open ${station.name} site`}
              data-testid="player-site-link"
            >
              <ExternalLink aria-hidden="true" size={14} strokeWidth={1.8} />
            </a>
          ) : null}

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
        <div
          className="player-ticker__meta"
          style={metaResolving ? { opacity: 0.6 } : undefined}
          title={metaResolving ? "New track just detected — details still resolving" : undefined}
          data-testid={metaResolving ? "player-ticker-resolving" : undefined}
        >
          <div className="player-ticker__meta-line player-ticker__meta-song">
            {metaSong ?? "—"}
          </div>
          <div className="player-ticker__meta-line player-ticker__meta-artist">
            {metaAlbum ?? "—"}
          </div>
          <div className="player-ticker__meta-line player-ticker__meta-station">
            {scanActive && scanCurrent
              ? `${metaArtist ?? "—"} · ${scanCurrent.stationName}`
              : (metaArtist ?? "—")}
          </div>
        </div>
        {scanActive && scanCurrent?.mbid ? (
          <div className="mt-2">
            <KeepButton
              mbid={scanCurrent.mbid}
              compact
              provenance={{
                kind: "scan",
                stationSlug: scanCurrent.stationSlug,
                stationName: scanCurrent.stationName,
                surface: "categoryScan",
                entryPoint: "newMusic",
              }}
            />
          </div>
        ) : null}
      </div>
      <LandingConfirmationNote
        confirmation={landingConfirmation}
        activeSlug={station.slug}
      />
      {handoff && <LiveHandoffPanel {...handoff} />}
    </div>
  );
}
