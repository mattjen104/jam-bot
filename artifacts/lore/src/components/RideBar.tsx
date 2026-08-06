import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { Link } from "wouter";
import type { RecordingLink } from "@workspace/api-client-react";
import type { RideApi } from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { rideFallbackLabel, rankServices } from "../player/playbackSession";
import { KeepButton } from "./KeepButton";
import { ShareButton } from "./ShareButton";
import { DevicePicker } from "./DevicePicker";
import { onArtError } from "../lib/rumours";
import { toast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ExternalLink,
  FolderOpen,
  History,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Route as RouteIcon,
  Settings,
  ShoppingBag,
  SkipForward,
  Youtube,
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

// ---------------------------------------------------------------------------
// Source + attribution labels
// ---------------------------------------------------------------------------

/**
 * Human-readable label for which service is carrying the ride audio.
 * Covers all user-facing modes; Spotify is included for completeness but is
 * not surfaced in the options panel (developer-only).
 */
function rideSourceLabel(source: RideApi["source"]): string {
  switch (source) {
    case "youtube":
      return "Riding full tracks on YouTube";
    case "apple-music":
      return "Riding full tracks on Apple Music";
    case "spotify":
      return "Riding full tracks on Spotify";
    case "preview":
      return "Playing 30s previews";
    default:
      return "Hearing the broadcast";
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Cascade transparency chip — shows which service is currently playing.
 * Tapping it opens the Connection Centre.
 */
function SourceChip({
  source,
  sourceLabel,
  onOpenCentre,
}: {
  source: RideApi["source"];
  sourceLabel: string | null;
  onOpenCentre: () => void;
}) {
  if (!source || source === "preview" || !sourceLabel) return null;

  const icon =
    source === "youtube" ? (
      <Youtube className="h-3 w-3 shrink-0" />
    ) : source === "apple-music" ? (
      <Music2 className="h-3 w-3 shrink-0" />
    ) : source === "local-file" ? (
      <FolderOpen className="h-3 w-3 shrink-0" />
    ) : source === "bandcamp" ? (
      <ShoppingBag className="h-3 w-3 shrink-0" />
    ) : null;

  return (
    <button
      type="button"
      onClick={onOpenCentre}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      title="Open Connection Centre"
      data-testid="ride-source-chip"
    >
      {icon}
      Playing via {sourceLabel}
    </button>
  );
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

  // Fallback toast: fire once per source downgrade (e.g. Spotify → YouTube).
  //
  // PlayerProvider clears source to `null` before the cascade fires the next
  // driver, so the real transition is e.g. `spotify → null → youtube` not
  // `spotify → youtube` directly.  Using a plain prevSourceRef would see the
  // `null` update and lose the Spotify context.
  //
  // Fix: keep a separate ref that only advances when source becomes a
  // "preferred" service (spotify / apple-music).  Null and fallback sources
  // do NOT update it, so the context survives through the null intermediate.
  const lastPreferredSourceRef = useRef<"spotify" | "apple-music" | null>(null);
  useEffect(() => {
    const next = ride.source;
    // Advance the preferred-source tracker.
    if (next === "spotify" || next === "apple-music") {
      lastPreferredSourceRef.current = next;
      return; // no toast when switching *to* a preferred service
    }
    // Detect downgrade: preferred service had been active, now a fallback took over.
    if (
      lastPreferredSourceRef.current !== null &&
      (next === "youtube" || next === "bandcamp")
    ) {
      const prevLabel =
        lastPreferredSourceRef.current === "spotify" ? "Spotify" : "Apple Music";
      const nextLabel = next === "youtube" ? "YouTube" : "Bandcamp";
      toast({
        title: `Switched to ${nextLabel}`,
        description: `${prevLabel} wasn't available for this track. Reconnect for full quality.`,
        duration: 4000,
      });
      // Clear so the same fallback session doesn't fire again on subsequent
      // tracks that also use the fallback driver.
      lastPreferredSourceRef.current = null;
    }
  }, [ride.source]);

  const isPlaying = ride.status === "playing";
  const isLoading = ride.status === "loading" || ride.seeking;
  // Any service driver (YouTube, Apple Music, or Spotify for devs) provides
  // full-track playback — controls stay enabled even when previewUrl is absent.
  const onServiceDriver =
    ride.source === "spotify" ||
    ride.source === "youtube" ||
    ride.source === "apple-music" ||
    ride.source === "local-file" ||
    ride.source === "bandcamp";
  const noPreview = cur.previewUrl === null && !onServiceDriver;

  const bestLink =
    cur.links.find((l: RecordingLink) => l.kind === "exact") ??
    cur.links[0] ??
    null;

  // Ranked service options for the tiered options panel.
  const trackHasYouTube = cur.links.some((l) =>
    l.url.includes("youtube.com") || l.url.includes("youtu.be"),
  );
  const trackHasAppleMusic = cur.links.some((l) =>
    /apple_music|applemusic|apple music|appleMusic/i.test(l.name),
  );
  const rankedSvcs = useMemo(
    () =>
      rankServices({
        appleMusicConfigured: ride.appleMusicConfigured,
        appleMusicAuthorized: ride.appleMusicConnected,
        trackHasYouTube,
        trackHasAppleMusic,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ride.appleMusicConfigured, ride.appleMusicConnected, trackHasYouTube, trackHasAppleMusic],
  );

  // Determine which mode / service is currently active for highlighting.
  const inServiceRide = ride.playbackMode === "resolve_to_service";
  const activeServiceId = inServiceRide ? (ride.preferredService ?? null) : null;

  const handleServiceClick = (id: "youtube" | "apple-music") => {
    if (activeServiceId === id) {
      // Toggle off — return to broadcast.
      ride.setPlaybackMode("passthrough");
    } else {
      ride.setPreferredService(id);
    }
  };

  const handleBroadcastClick = () => {
    ride.setPlaybackMode("passthrough");
  };

  return (
    <div
      className="fixed z-40 border border-border bg-secondary/95 backdrop-blur-md shadow-lg bottom-[68px] left-4 right-4 rounded-[18px] lg:bottom-[68px] lg:left-4 lg:right-4"
      data-testid="ride-bar"
    >
      {/* ── Live-to-past crossing interstitial gate ─────────────────────── */}
      {/* ⚠️ FLAGGED — companion-mode interstitial crossing.                  */}
      {/* Shown while the interstitial is armed (silence placeholder or a     */}
      {/* real Lore tone once approved). If a device mismatch was detected,   */}
      {/* the listener must confirm before past replay begins.                */}
      {ride.interstitialArmed ? (
        <div
          className="border-b border-border/60 bg-background/40"
          data-testid="ride-crossing-interstitial"
        >
          {ride.deviceMismatch ? (
            // Mismatch: listener must pick/confirm the right device first.
            <div className="px-5 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[11px] text-muted-foreground">
                  Replay will play on your pinned device — confirm to continue.
                </p>
                <button
                  type="button"
                  onClick={ride.dismissDeviceMismatch}
                  aria-label="Continue"
                  data-testid="ride-device-mismatch-confirm"
                  className="hover-elevate shrink-0 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                >
                  Continue
                </button>
              </div>
              {/* Let the listener switch devices directly from this banner. */}
              <div className="mt-1.5 flex justify-start">
                <DevicePicker spotify={spotify} />
              </div>
            </div>
          ) : (
            // No mismatch (or check pending): brief "Crossing to replay…" state.
            <div className="flex items-center gap-2 px-5 py-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="font-mono text-[11px] text-muted-foreground">
                Crossing to replay…
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* One-shot notice (OAuth return or device availability). */}
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

      {/* Tiered playback options panel */}
      <div className="border-b border-border/60 bg-background/40 px-5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* Settings icon to open Connection Centre */}
          <button
            type="button"
            onClick={ride.openConnectionCentre}
            aria-label="Open Connection Centre"
            data-testid="ride-connection-centre"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            title="Connection Centre — manage playback services"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          {/* ── Seamless service options (YouTube, Apple Music) ── */}
          {rankedSvcs.map((svc) => {
            const isActive = activeServiceId === svc.id;
            return (
              <button
                key={svc.id}
                type="button"
                onClick={() => handleServiceClick(svc.id)}
                disabled={!svc.trackSupported && !isActive}
                data-testid={`ride-service-${svc.id}`}
                title={
                  svc.requiresConnect
                    ? `Connect ${svc.label} to ride full tracks`
                    : !svc.trackSupported
                    ? `No ${svc.label} link for this track`
                    : undefined
                }
                className={[
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors",
                  isActive
                    ? "border-primary-border bg-primary/10 text-primary"
                    : svc.trackSupported
                    ? "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    : "border-border text-muted-foreground opacity-40 cursor-not-allowed",
                ].join(" ")}
              >
                {svc.id === "youtube" ? (
                  <Youtube className="h-3.5 w-3.5" />
                ) : (
                  <Music2 className="h-3.5 w-3.5" />
                )}
                {svc.label}
                {svc.requiresConnect ? (
                  <span className="opacity-60 text-[10px]">connect</span>
                ) : null}
              </button>
            );
          })}

          {/* ── Broadcast (always available) ── */}
          <button
            type="button"
            onClick={handleBroadcastClick}
            data-testid="ride-broadcast"
            className={[
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px] transition-colors",
              !inServiceRide
                ? "border-primary-border bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            ].join(" ")}
          >
            <Radio className="h-3.5 w-3.5" />
            Broadcast
          </button>

          {/* ── Open in Spotify (secondary action — leaves the app) ── */}
          {ride.spotifyDeepLink ? (
            <a
              href={ride.spotifyDeepLink}
              data-testid="ride-open-spotify"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              title="Opens in your Spotify app — won't autoadvance"
            >
              <ExternalLink className="h-3 w-3" />
              Open in Spotify
            </a>
          ) : null}

          {/* ── Buy on Bandcamp (album-scope only) ── */}
          {ride.bandcampAlbumUrl ? (
            <a
              href={ride.bandcampAlbumUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="ride-buy-bandcamp"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ShoppingBag className="h-3 w-3" />
              Buy on Bandcamp
            </a>
          ) : null}
        </div>

        {/* ── Buffer-outrun: scrub head has outrun the prefetch buffer ── */}
        {/* Show "Finding this on [Service]…" so the listener never sees silence */}
        {ride.bufferOutrun ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
              data-testid="ride-buffer-outrun"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {ride.sourceLabel
                ? `Finding this on ${ride.sourceLabel}…`
                : "Finding this track…"}
            </span>
          </div>
        ) : null}

        {/* ── Fallback / status line ── */}
        {ride.fallbackUsed ? (
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
              data-testid="ride-fallback-indicator"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {rideFallbackLabel(
                ride.deviceLost,
                ride.timeOrientation,
                // When the user explicitly chose a service, name it in the
                // fallback copy. Defaults to "spotify" for the connect path.
                ride.preferredService ?? "spotify",
              )}
              <button
                type="button"
                onClick={ride.retrySpotify}
                data-testid="ride-retry-spotify"
                className="hover-elevate inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary transition-opacity hover:bg-primary/20"
                title="Retry playing this track on your connected service"
              >
                <RefreshCw className="h-2.5 w-2.5" />
                Retry
              </button>
            </span>
          </div>
        ) : inServiceRide && ride.source && ride.source !== "preview" ? (
          <div className="mt-1">
            <span className="font-mono text-[10px] text-muted-foreground">
              {rideSourceLabel(ride.source)}
            </span>
          </div>
        ) : null}

        {/* Device picker — shown only when Spotify (dev mode) is actively playing */}
        {inServiceRide && ride.source === "spotify" ? (
          <div className="mt-1.5 flex justify-end">
            <DevicePicker spotify={spotify} />
          </div>
        ) : null}
      </div>

      {/* Seek bar — interactive for full-track drivers that support seeking */}
      {(ride.source === "youtube" || ride.source === "apple-music" || ride.source === "local-file") && (
        <SeekBar
          progressMs={ride.progressMs}
          durationMs={ride.durationMs}
          onSeek={ride.seek}
        />
      )}
      {/* Progress bar — read-only for Spotify, Bandcamp, and preview sources */}
      {(ride.source === "spotify" || ride.source === "bandcamp" || ride.source === "preview") && (
        <ProgressBar
          progressMs={ride.progressMs}
          durationMs={ride.durationMs}
        />
      )}
      {/* Cascade transparency chip */}
      {ride.source && ride.source !== "preview" && ride.sourceLabel && (
        <div className="px-5 pb-1">
          <SourceChip
            source={ride.source}
            sourceLabel={ride.sourceLabel}
            onOpenCentre={ride.openConnectionCentre}
          />
        </div>
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
            src={proxyArtUrl(cur.artworkUrl)!}
            alt=""
            className="hidden h-11 w-11 shrink-0 rounded-md object-cover sm:block"
            onError={onArtError}
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
            {onServiceDriver && ride.source !== null && ride.source !== "preview"
              ? ` · ${ride.source === "youtube" ? "YouTube" : ride.source === "apple-music" ? "Apple Music" : ""}`
              : ""}
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
