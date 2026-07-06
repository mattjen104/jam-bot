import { Link } from "wouter";
import type { RecordingLink } from "@workspace/api-client-react";
import type { RideApi } from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { rideFallbackLabel } from "../player/playbackSession";
import { KeepButton } from "./KeepButton";
import { ShareButton } from "./ShareButton";
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
  const noPreview = cur.previewUrl === null && !onSpotify;
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
      className="fixed z-40 border border-border bg-secondary/95 backdrop-blur-md shadow-lg bottom-4 left-4 right-4 rounded-[18px] lg:bottom-0 lg:left-[220px] lg:right-0 lg:rounded-none lg:shadow-none lg:border-x-0 lg:border-b-0"
      data-testid="ride-bar"
    >
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
                    ? "Riding full tracks on your Spotify"
                    : "Hearing the broadcast"}
                </span>
              )}
            </div>

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
      ) : null}

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
          disabled={noPreview && ride.source !== "spotify"}
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
            {noPreview && !onSpotify
              ? "No preview — open externally"
              : attributionLine(ride)}
            {onSpotify ? " · Full track on your Spotify" : ""}
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
