import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import type { RecordingLink } from "@workspace/api-client-react";
import type { RideApi } from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { rideFallbackLabel } from "../player/playbackSession";
import { KeepButton } from "./KeepButton";
import { ShareButton } from "./ShareButton";
import { DevicePicker } from "./DevicePicker";
import {
  AlertTriangle,
  ExternalLink,
  History,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Route as RouteIcon,
  SkipForward,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Progress / seek bar
// ---------------------------------------------------------------------------

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Read-only progress bar shown for Spotify and preview sources.
 * Visually identical to SeekBar's track, but has no interactive range input —
 * seeking is not supported for these sources.
 */
function ProgressBar({
  progressMs,
  durationMs,
}: {
  progressMs: number | null;
  durationMs: number | null;
}) {
  const duration = durationMs ?? 0;
  const progress = progressMs ?? 0;
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  return (
    <div className="px-5 pb-2">
      <div className="relative flex items-center gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          {formatTime(progress)}
        </span>
        {/* Visual track — no interactive overlay */}
        <div
          className="relative h-1 flex-1 overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={duration > 0 ? duration : 100}
          aria-label="Playback progress"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">
          {duration > 0 ? formatTime(duration) : "--:--"}
        </span>
      </div>
    </div>
  );
}

/**
 * Interactive seek bar shown for YouTube and Apple Music sources.
 * Uses a hidden range input overlaid on a visual track so the drag handle
 * matches the design system.
 *
 * Exported for unit tests.
 */
export function SeekBar({
  progressMs,
  durationMs,
  onSeek,
}: {
  progressMs: number | null;
  durationMs: number | null;
  onSeek: (ms: number) => void;
}) {
  // While the user is scrubbing we show their drag position, not the live
  // playhead, so the bar doesn't jump beneath their finger/cursor.
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const rangeRef = useRef<HTMLInputElement>(null);

  const duration = durationMs ?? 0;
  const progress = scrubbing ? scrubValue : (progressMs ?? 0);
  const pct = duration > 0 ? Math.min(100, (progress / duration) * 100) : 0;

  const handlePointerDown = useCallback(() => {
    setScrubbing(true);
    setScrubValue(progressMs ?? 0);
  }, [progressMs]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setScrubValue(Number(e.target.value));
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLInputElement>) => {
      const val = Number((e.target as HTMLInputElement).value);
      setScrubbing(false);
      onSeek(val);
    },
    [onSeek],
  );

  return (
    <div className="px-5 pb-2">
      <div className="relative flex items-center gap-2">
        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
          {formatTime(progress)}
        </span>
        {/* Visual track */}
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-border">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Range input — transparent overlay for interaction */}
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          value={scrubbing ? scrubValue : (progressMs ?? 0)}
          step={500}
          onPointerDown={handlePointerDown}
          onChange={handleChange}
          onPointerUp={handlePointerUp}
          aria-label="Seek position"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ margin: 0 }}
        />
        <span className="w-8 shrink-0 font-mono text-[10px] text-muted-foreground">
          {duration > 0 ? formatTime(duration) : "--:--"}
        </span>
      </div>
    </div>
  );
}

/**
 * Human-readable label for which service is carrying the ride audio.
 * Falls back to a generic label for unknown/null sources.
 */
function rideSourceLabel(source: RideApi["source"]): string {
  switch (source) {
    case "spotify":
      return "Riding full tracks on your Spotify";
    case "youtube":
      return "Riding full tracks on your YouTube";
    case "apple-music":
      return "Riding full tracks on your Apple Music";
    default:
      return "Riding full tracks";
  }
}

/** Friendly label for how we arrived at the current ride track. */
function attributionLine(ride: RideApi): string {
  const cur = ride.current;
  if (!cur) return "";
  if (ride.mode === "replay") {
    return ride.replayLabel ? `Replaying ${ride.replayLabel}` : "Replaying a run";
  }
  if (!cur.attribution) return "Riding from here";
  const picker = cur.attribution.pickers[0];
  if (picker) return `Sequenced by ${picker.name}`;
  const station = cur.attribution.stations[0];
  if (station) return `Segued on ${station.name}`;
  return "A real transition";
}

export function RideBar({
  ride,
  spotify,
}: {
  ride: RideApi;
  spotify: SpotifyConnectApi;
}) {
  const cur = ride.current;
  if (!cur) return null;

  const isPlaying = ride.status === "playing";
  const isLoading = ride.status === "loading" || ride.seeking;
  const onSpotify = ride.source === "spotify";
  // Any service driver (Spotify, YouTube, Apple Music) provides full-track
  // playback — controls stay enabled even when previewUrl is absent.
  const onServiceDriver =
    ride.source === "spotify" ||
    ride.source === "youtube" ||
    ride.source === "apple-music";
  const noPreview = cur.previewUrl === null && !onServiceDriver;
  const bestLink =
    cur.links.find((l: RecordingLink) => l.kind === "exact") ??
    cur.links[0] ??
    null;

  // Mode toggle is shown only when the user has a connected Premium Spotify.
  const canToggleMode = spotify.connected && spotify.premium;
  const inServiceRide = ride.playbackMode === "resolve_to_service";

  const handleModeToggle = () => {
    ride.setPlaybackMode(inServiceRide ? "passthrough" : "resolve_to_service");
  };

  return (
    <div
      className="fixed z-40 border border-border bg-secondary/95 backdrop-blur-md shadow-lg bottom-[68px] left-4 right-4 rounded-[18px] lg:bottom-[68px] lg:left-4 lg:right-4"
      data-testid="ride-bar"
    >
      {/* One-shot notice (OAuth return or device availability). Reuses the same
          banner style as PlayerDock so the pattern is consistent. */}
      {spotify.notice ? (
        <div className="border-b border-border/60 bg-background/40">
          <div className="flex items-center justify-between gap-3 px-5 py-1.5">
            <p
              className="truncate font-mono text-[11px] text-muted-foreground"
              data-testid="spotify-notice"
            >
              {spotify.notice}
            </p>
            <button
              type="button"
              onClick={spotify.clearNotice}
              aria-label="Dismiss"
              className="hover-elevate shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              OK
            </button>
          </div>
        </div>
      ) : null}

      {/* Connect Spotify prompt — shown when configured but not yet connected. */}
      {spotify.configured && !spotify.connected ? (
        <div className="border-b border-border/60 bg-background/40">
          <div className="flex items-center justify-between gap-3 px-5 py-1.5">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              Rides play 30s previews. Connect Spotify to ride full tracks on
              your own player.
            </p>
            <button
              type="button"
              onClick={spotify.connect}
              data-testid="spotify-connect"
              className="hover-elevate inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary-border bg-primary/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-primary"
            >
              <Music2 className="h-3.5 w-3.5" />
              Connect Spotify
            </button>
          </div>
        </div>
      ) : null}

      {/* Non-premium notice. */}
      {spotify.connected && !spotify.premium ? (
        <div className="border-b border-border/60 bg-background/40">
          <div className="px-5 py-1.5">
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              Spotify connected, but full-track control needs Premium — rides
              stay on 30s previews.
            </p>
          </div>
        </div>
      ) : null}

      {/* Mode toggle + fallback indicator — only when Spotify Premium is ready. */}
      {canToggleMode ? (
        <div className="border-b border-border/60 bg-background/40">
          <div className="flex items-center justify-between gap-3 px-5 py-1.5">
            <div className="flex items-center gap-2">
              {ride.fallbackUsed ? (
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
                  data-testid="ride-fallback-indicator"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {rideFallbackLabel(ride.deviceLost, ride.timeOrientation)}
                  <button
                    type="button"
                    onClick={ride.retrySpotify}
                    data-testid="ride-retry-spotify"
                    className="hover-elevate inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary transition-opacity hover:bg-primary/20"
                    title="Retry playing this track on your Spotify"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    Retry
                  </button>
                </span>
              ) : (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {inServiceRide
                    ? rideSourceLabel(ride.source)
                    : "Hearing the broadcast"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Device picker — shown when riding in Spotify only */}
              {inServiceRide && ride.source === "spotify" ? (
                <DevicePicker spotify={spotify} />
              ) : null}

              <button
                type="button"
                onClick={handleModeToggle}
                data-testid="ride-mode-toggle"
                className="hover-elevate inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-foreground"
                title={
                  inServiceRide
                    ? "Switch to hearing the broadcast stream"
                    : "Switch to riding full tracks on your Spotify"
                }
              >
                {inServiceRide ? (
                  <>
                    <Radio className="h-3.5 w-3.5" />
                    Hear the broadcast
                  </>
                ) : (
                  <>
                    <Music2 className="h-3.5 w-3.5" />
                    Ride in Spotify
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Seek bar — interactive for full-track drivers that support seeking */}
      {(ride.source === "youtube" || ride.source === "apple-music") && (
        <SeekBar
          progressMs={ride.progressMs}
          durationMs={ride.durationMs}
          onSeek={ride.seek}
        />
      )}
      {/* Progress bar — read-only for Spotify and preview sources */}
      {(ride.source === "spotify" || ride.source === "preview") && (
        <ProgressBar
          progressMs={ride.progressMs}
          durationMs={ride.durationMs}
        />
      )}

      <div className="flex items-center gap-4 px-5 py-3">
        <span
          className="hidden shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary sm:inline-flex"
          data-testid="ride-mode-badge"
        >
          {ride.mode === "replay" ? (
            <History className="h-3.5 w-3.5" />
          ) : (
            <RouteIcon className="h-3.5 w-3.5" />
          )}
          {ride.mode === "replay"
            ? `Replay ${ride.index + 1}/${ride.queue.length}`
            : "Riding"}
        </span>

        <button
          type="button"
          onClick={ride.togglePause}
          disabled={noPreview}
          aria-label={isPlaying ? "Pause ride" : "Play ride"}
          data-testid="ride-toggle"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary-border bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95 disabled:opacity-40"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isPlaying ? (
            <Pause className="h-5 w-5 fill-current" />
          ) : (
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          )}
        </button>

        {cur.artworkUrl ? (
          <img
            src={cur.artworkUrl}
            alt=""
            className="hidden h-11 w-11 shrink-0 rounded-md object-cover sm:block"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <Link
            href={`/song/${cur.mbid}`}
            className="block truncate font-serif text-base font-semibold text-foreground hover:text-primary"
            data-testid="ride-title"
          >
            {cur.title}
          </Link>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {cur.artist}
            {" · "}
            {noPreview
              ? "No preview — open externally"
              : attributionLine(ride)}
            {onServiceDriver ? ` · Full track on your ${rideSourceLabel(ride.source).split(" on your ")[1] ?? "player"}` : ""}
            {ride.status === "ended" ? " · trail ends here" : ""}
          </p>
          {/* Hinge hint row — shortcut links to lean-in detail */}
          {cur.mbid && (
            <div
              className="mt-0.5 flex items-center gap-2 font-mono text-[10px]"
              style={{ color: "hsl(var(--faint))" }}
            >
              <Link
                href={`/song/${cur.mbid}`}
                className="transition-colors hover:text-primary"
              >
                Dive in ↗
              </Link>
              <span>·</span>
              <span>What plays next →</span>
            </div>
          )}
        </div>

        {cur.mbid && (
          <span className="inline-flex shrink-0 items-center gap-1.5">
            <KeepButton mbid={cur.mbid} />
            <ShareButton compact sharePath={`songs/${cur.mbid}`} kind="song" />
          </span>
        )}

        {bestLink ? (
          <a
            href={bestLink.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open this track externally"
            className="hover-elevate hidden h-9 items-center gap-1.5 rounded-full border border-border px-3 text-sm text-muted-foreground sm:inline-flex"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open
          </a>
        ) : null}

        <button
          type="button"
          onClick={ride.next}
          disabled={ride.atTrailEnd && ride.index === ride.queue.length - 1}
          aria-label="Next track"
          data-testid="ride-next"
          className="hover-elevate flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-40"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={ride.stop}
          aria-label="Stop riding"
          data-testid="ride-stop"
          className="hover-elevate flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
