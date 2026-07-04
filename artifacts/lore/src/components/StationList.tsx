import { Link } from "wouter";
import type {
  NowPlaying,
  PickedLookupItem,
  RecordingAvailabilityItem,
  Station,
  StationRecentSpin,
  StationScheduleRun,
} from "@workspace/api-client-react";
import { QualityBadge } from "./QualityBadge";
import { KeepButton } from "./KeepButton";
import { FollowButton } from "./FollowButton";
import { BadgeCheck, Mic, Mic2, Music2, Pause, Play, Radio } from "lucide-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";

interface StationListProps {
  stations: Station[];
  activeSlug: string | null;
  status: PlayerStatus;
  /** The dial pulse: latest spin per station slug (album art + show/DJ). */
  pulse?: Map<string, NowPlaying | null>;
  /**
   * Mode intersection badges: station slug → the strongest editorial pick of
   * the song it's spinning right now ("KEXP is playing a Pitchfork pick").
   */
  picked?: Map<string, PickedLookupItem>;
  /**
   * Show timeline: station slug → ordered array of that day's show blocks.
   * When provided, a horizontal timeline strip is rendered on each card.
   */
  schedule?: Map<string, StationScheduleRun[]>;
  /**
   * Recent individual spins: station slug → last N spins for the day.
   * Used for showless stations (e.g. Radio Paradise) where every run has
   * show: null — renders a per-track chip strip instead of run blocks.
   */
  recentSpins?: Map<string, StationRecentSpin[]>;
  /**
   * Metadata availability for the currently-playing recording per station.
   * When present, shows lyrics / SE episode chips on each card.
   */
  availability?: Map<string, RecordingAvailabilityItem>;
  onToggle: (station: Station) => void;
  onSelect: (station: Station) => void;
}

export function StationList({
  stations,
  activeSlug,
  status,
  pulse,
  picked,
  schedule,
  recentSpins,
  availability,
  onToggle,
  onSelect,
}: StationListProps) {
  return (
    <ul className="flex flex-col gap-2" data-testid="station-list">
      {stations.map((station) => {
        const isActive = station.slug === activeSlug;
        const isPlaying = isActive && status === "playing";
        const isLoading = isActive && status === "loading";
        const np = pulse?.get(station.slug) ?? null;
        const pick = picked?.get(station.slug) ?? null;
        const runs = schedule?.get(station.slug) ?? null;
        const spins = recentSpins?.get(station.slug) ?? null;
        // Showless = every run has show: null (e.g. Radio Paradise). Use
        // per-track chips instead of show-block chips for these stations.
        const isShowless = runs
          ? runs.length === 0 || runs.every((r) => !r.show)
          : false;
        const avail = availability?.get(station.slug) ?? null;
        const artwork = np?.recording?.artworkUrl ?? np?.artworkUrl ?? null;
        const trackLine = np
          ? [np.recording?.title ?? np.rawTitle, np.recording?.artist ?? np.rawArtist]
              .filter(Boolean)
              .join(" · ")
          : null;
        return (
          <li key={station.slug}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(station)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(station);
                }
              }}
              data-testid={`station-${station.slug}`}
              className={`hover-elevate group flex items-center gap-4 rounded-xl border p-3 pr-4 transition-colors ${
                isActive
                  ? "border-primary-border bg-primary/[0.06]"
                  : "border-card-border bg-card"
              }`}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(station);
                }}
                aria-label={isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
                data-testid={`toggle-${station.slug}`}
                className={`relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm transition-transform active:scale-95 ${
                  artwork
                    ? "border-border bg-muted"
                    : "border-primary-border bg-primary text-primary-foreground"
                }`}
              >
                {artwork && (
                  <>
                    <img
                      src={artwork}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                      data-testid={`pulse-artwork-${station.slug}`}
                    />
                    <span className="absolute inset-0 bg-black/35 transition-colors group-hover:bg-black/45" />
                  </>
                )}
                <span
                  className={`relative ${artwork ? "text-white drop-shadow" : ""}`}
                >
                  {isLoading ? (
                    <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                  ) : isPlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  )}
                </span>
              </button>

              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
                    {station.name}
                  </h3>
                  {isPlaying && (
                    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="lore-eq-bar w-[2px] bg-primary"
                          style={{ height: "12px", animationDelay: `${i * 140}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                {trackLine ? (
                  <p
                    className="mt-0.5 truncate text-xs text-foreground/80"
                    data-testid={`pulse-track-${station.slug}`}
                  >
                    {trackLine}
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                    <Radio className="h-3 w-3" />
                    {[station.org, station.country].filter(Boolean).join(" · ") ||
                      "Independent"}
                  </p>
                )}
                {np?.show && (
                  <p
                    className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                    data-testid={`pulse-show-${station.slug}`}
                  >
                    <Mic className="h-3 w-3 text-primary/70" />
                    {np.show.djName
                      ? `${np.show.djName} · ${np.show.name}`
                      : np.show.name}
                  </p>
                )}
                {pick &&
                  (pick.runId != null ? (
                    <Link
                      href={`/archive/picker-runs/${pick.runId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-primary-border bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary hover:bg-primary/20"
                      title={
                        pick.listTitle
                          ? `${pick.picker.name} — ${pick.listTitle}`
                          : pick.picker.name
                      }
                      data-testid={`picked-badge-${station.slug}`}
                    >
                      <BadgeCheck className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {pick.picker.name} pick
                      </span>
                    </Link>
                  ) : (
                    <span
                      className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-primary-border bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary"
                      title={
                        pick.listTitle
                          ? `${pick.picker.name} — ${pick.listTitle}`
                          : pick.picker.name
                      }
                      data-testid={`picked-badge-${station.slug}`}
                    >
                      <BadgeCheck className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {pick.picker.name} pick
                      </span>
                    </span>
                  ))}

                {/* Metadata availability chips for the current track */}
                {avail && (avail.hasLyrics || avail.hasSe) && (
                  <div
                    className="mt-1 flex gap-1 overflow-x-auto"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {/* When there's no show/DJ name, embed the track title as
                        the leading chip so the metadata chips have context */}
                    {!np?.show && trackLine && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap"
                        title={trackLine}
                      >
                        <span className="max-w-[18ch] truncate">{trackLine}</span>
                      </span>
                    )}
                    {avail.hasLyrics && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap"
                        title="Synced lyrics available"
                        data-testid={`chip-lyrics-${station.slug}`}
                      >
                        <Music2 className="h-2.5 w-2.5 shrink-0" />
                        Lyrics
                      </span>
                    )}
                    {avail.hasSe && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap"
                        title="Song Exploder episode available"
                        data-testid={`chip-se-${station.slug}`}
                      >
                        <Mic2 className="h-2.5 w-2.5 shrink-0" />
                        SE
                      </span>
                    )}
                  </div>
                )}

                {/* Timeline strip — show-blocks for named stations, track chips for showless ones */}
                {isShowless && spins && spins.length > 0 ? (
                  <TrackTimeline
                    spins={spins}
                    currentMbid={np?.recording?.mbid ?? null}
                    stationSlug={station.slug}
                  />
                ) : runs && runs.length > 0 && !isShowless ? (
                  <ShowTimeline
                    runs={runs}
                    stationSlug={station.slug}
                  />
                ) : null}
              </div>

              {/* Right rail: keep current track, follow station, quality badge */}
              <div
                className="flex shrink-0 flex-col items-end gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {np?.recording?.mbid && (
                  <KeepButton compact mbid={np.recording.mbid} />
                )}
                <FollowButton kind="station" id={station.slug} name={station.name} />
                <QualityBadge quality={station.streamQuality} format={station.streamFormat} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Horizontal scrollable strip of individual track chips for showless stations
 * (e.g. Radio Paradise). The most-recent spin is matched to the current MBID
 * and highlighted; all previous chips link to the song's detail page.
 */
function TrackTimeline({
  spins,
  currentMbid,
  stationSlug,
}: {
  spins: StationRecentSpin[];
  currentMbid: string | null;
  stationSlug: string;
}) {
  return (
    <div
      className="mt-1.5 flex gap-1 overflow-x-auto"
      style={{ scrollbarWidth: "none" }}
      data-testid={`track-timeline-${stationSlug}`}
      onClick={(e) => e.stopPropagation()}
    >
      {spins.map((spin, i) => {
        const label = [spin.title, spin.artist].filter(Boolean).join(" · ");
        // The first spin (newest) that matches the live now-playing MBID is active.
        const isActive = i === 0 && !!currentMbid && spin.mbid === currentMbid;
        const chipClass = `inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] whitespace-nowrap transition-colors ${
          isActive
            ? "border-primary/40 bg-primary/15 text-primary"
            : "border-border bg-background/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
        }`;
        if (spin.mbid && !isActive) {
          return (
            <Link
              key={i}
              href={`/songs/${spin.mbid}`}
              onClick={(e) => e.stopPropagation()}
              title={label}
              data-testid={`track-chip-${spin.mbid}`}
              className={chipClass}
            >
              <span className="max-w-[14ch] truncate">{label}</span>
            </Link>
          );
        }
        return (
          <span
            key={i}
            title={label}
            data-testid={isActive ? `track-chip-active-${stationSlug}` : `track-chip-unresolved-${i}`}
            className={chipClass}
          >
            {isActive && <span className="mr-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
            <span className="max-w-[14ch] truncate">{label || "—"}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Horizontal scrollable row of show/block chips for a station's day. */
function ShowTimeline({
  runs,
  stationSlug,
}: {
  runs: StationScheduleRun[];
  stationSlug: string;
}) {
  const now = Date.now();
  // "Active" = the block that contains right now, or the most recent one if
  // none span the current moment (e.g. station hasn't logged in a while).
  const activeRunId =
    runs.find(
      (r) =>
        new Date(r.startedAt).getTime() <= now &&
        new Date(r.endedAt).getTime() >= now - 4 * 60 * 60 * 1000,
    )?.runId ?? runs[runs.length - 1]?.runId;

  return (
    <div
      className="mt-1.5 flex gap-1 overflow-x-auto"
      style={{ scrollbarWidth: "none" }}
      data-testid={`show-timeline-${stationSlug}`}
      onClick={(e) => e.stopPropagation()}
    >
      {runs.map((run) => {
        const label = run.show?.name ?? "Station stream";
        const isActive = run.runId === activeRunId;
        const replayable = run.resolvedCount > 0;
        return (
          <Link
            key={run.runId}
            href={`/archive/station-runs/${run.runId}${replayable ? "?play=1" : ""}`}
            onClick={(e) => e.stopPropagation()}
            title={
              run.show?.djName
                ? `${run.show.djName} · ${label} · ${run.resolvedCount}/${run.spinCount} tracks playable`
                : `${label} · ${run.resolvedCount}/${run.spinCount} tracks playable`
            }
            data-testid={`show-chip-${run.runId}`}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] whitespace-nowrap transition-colors ${
              isActive
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-background/50 text-muted-foreground hover:border-primary/30 hover:text-foreground"
            }`}
          >
            {replayable && (
              <Play className="h-2 w-2 shrink-0 fill-current" />
            )}
            <span className="max-w-[12ch] truncate">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}
