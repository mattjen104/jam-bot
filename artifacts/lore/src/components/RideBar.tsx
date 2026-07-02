import { Link } from "wouter";
import type { RecordingLink } from "@workspace/api-client-react";
import type { RideApi } from "../player/PlayerProvider";
import {
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Route as RouteIcon,
  SkipForward,
  X,
} from "lucide-react";

/** Friendly label for how we arrived at the current ride track. */
function attributionLine(ride: RideApi): string {
  const cur = ride.current;
  if (!cur) return "";
  if (!cur.attribution) return "Riding from here";
  const picker = cur.attribution.pickers[0];
  if (picker) return `Sequenced by ${picker.name}`;
  const station = cur.attribution.stations[0];
  if (station) return `Segued on ${station.name}`;
  return "A real transition";
}

export function RideBar({ ride }: { ride: RideApi }) {
  const cur = ride.current;
  if (!cur) return null;

  const isPlaying = ride.status === "playing";
  const isLoading = ride.status === "loading" || ride.seeking;
  const noPreview = cur.previewUrl === null;
  const bestLink =
    cur.links.find((l: RecordingLink) => l.kind === "exact") ??
    cur.links[0] ??
    null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-primary-border bg-card/95 backdrop-blur-md"
      data-testid="ride-bar"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-primary sm:inline-flex">
          <RouteIcon className="h-3.5 w-3.5" />
          Riding
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
            {noPreview ? "No preview — open externally" : attributionLine(ride)}
            {ride.status === "ended" ? " · trail ends here" : ""}
          </p>
        </div>

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
