import type { Station } from "@workspace/api-client-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import type {
  RadioCastStatus,
  RadioCastFallbackReason,
} from "../player/PlayerProvider";
import type { SpotifyConnectApi } from "../player/useSpotifyConnect";
import { DevicePicker } from "./DevicePicker";
import { Cast, Loader2, Pause, Play, Radio, RotateCw, Volume2, VolumeX, X } from "lucide-react";
import { KeepButton } from "./KeepButton";
import { ShareButton } from "./ShareButton";

interface PlayerBarProps {
  station: Station;
  status: PlayerStatus;
  volume: number;
  error: string | null;
  /** MBID of the currently-identified track, if resolved. */
  nowPlayingMbid?: string | null;
  /** Live-cast state — non-"off" when the station resolves to Spotify. */
  casting?: RadioCastStatus;
  /** Why the cast fell back — null unless casting === "fallback". */
  castFallbackReason?: RadioCastFallbackReason | null;
  /** True when the cast is paused on the listener's Spotify. */
  castPaused?: boolean;
  /** Retry Spotify for the current track after a retryable cast fallback. */
  onCastRetry?: () => void;
  onToggle: (station: Station) => void;
  onStop: () => void;
  onVolume: (v: number) => void;
  /** Spotify Connect state — when provided and connected+premium, shows the device picker. */
  spotify?: SpotifyConnectApi;
}

export function PlayerBar({
  station,
  status,
  volume,
  error,
  nowPlayingMbid,
  casting = "off",
  castFallbackReason = null,
  castPaused = false,
  onCastRetry,
  onToggle,
  onStop,
  onVolume,
  spotify,
}: PlayerBarProps) {
  const isCasting = casting === "casting";
  const isPlaying = isCasting ? !castPaused : status === "playing";
  const isLoading = !isCasting && status === "loading";
  const showDevicePicker = !!(spotify?.connected && spotify.premium);
  // Not connected yet — show the cast icon as an entry point to connect.
  const showConnectPrompt = !!(spotify?.configured && !spotify.connected);
  const castDeviceName = spotify?.pinnedDevice?.name ?? "your Spotify";
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
            ) : isCasting ? (
              castPaused ? (
                `Paused on ${castDeviceName}`
              ) : (
                <>
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                    aria-hidden
                  />
                  {`Live · casting to ${castDeviceName}`}
                </>
              )
            ) : casting === "connecting" ? (
              "Waiting for a track to resolve to Spotify…"
            ) : casting === "fallback" ? (
              <>
                {castFallbackReason === "rate_limited"
                  ? "Spotify is rate-limited right now · playing the broadcast"
                  : castFallbackReason === "spotify_error"
                    ? "Spotify unavailable · playing the broadcast"
                    : "Not on Spotify · playing the broadcast"}
                {castFallbackReason !== "not_on_spotify" && onCastRetry && (
                  <button
                    type="button"
                    onClick={onCastRetry}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 transition-colors hover:bg-secondary"
                    title="Try Spotify again for this track"
                    data-testid="cast-retry"
                  >
                    <RotateCw className="h-2.5 w-2.5" aria-hidden />
                    Retry
                  </button>
                )}
              </>
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
          {/* Compact Keep + Share — shown whenever a track is identified */}
          {nowPlayingMbid && (
            <>
              <KeepButton
                mbid={nowPlayingMbid}
                compact
                provenance={{ kind: "keep", stationSlug: station.slug }}
              />
              <ShareButton compact sharePath={`songs/${nowPlayingMbid}`} kind="song" />
            </>
          )}
          {/* Device picker — shown when Spotify is connected (unless the
              account is explicitly non-premium) */}
          {showDevicePicker && spotify ? (
            <DevicePicker spotify={spotify} />
          ) : showConnectPrompt && spotify ? (
            <button
              type="button"
              onClick={spotify.connect}
              aria-label="Connect Spotify to cast to your devices"
              title="Connect Spotify to cast this station to your speakers"
              data-testid="cast-connect-button"
              className="hover-elevate flex h-9 items-center gap-1.5 rounded-full border border-border px-2.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <Cast className="h-3.5 w-3.5 shrink-0" />
            </button>
          ) : null}
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
