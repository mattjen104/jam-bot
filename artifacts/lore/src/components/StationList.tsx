import { Link } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import type {
  NowPlaying,
  PickedLookupItem,
  RecordingAvailabilityItem,
  ScrapedShow,
  Station,
  StationRecentSpin,
  StationScheduleRun,
} from "@workspace/api-client-react";
import {
  useGetStationUpcomingSchedule,
  getGetStationUpcomingScheduleQueryKey,
} from "@workspace/api-client-react";
import { QualityBadge } from "./QualityBadge";
import { BadgeCheck, BookOpen, ExternalLink, Info, Mic, Mic2, Music2, Pause, Play, Radio, Volume2 } from "lucide-react";
import type { PlayerStatus } from "../hooks/useRadioPlayer";
import { safeHttpUrl } from "../lib/utils";

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
  /** When true, renders each card with the full featured layout (blurb +
   * scraped upcoming shows + clickable genre tags). */
  featured?: boolean;
  /**
   * Scraped schedule overlay: station slug → the show currently airing
   * according to the weekly schedule. Used as a subtitle fallback when the
   * server hasn't polled a live track for this station yet.
   */
  currentShow?: Map<string, { showName: string; djName: string | null }>;
  onToggle: (station: Station) => void;
  onSelect: (station: Station) => void;
  /** Called when the user clicks a genre tag chip (featured mode). */
  onGenreClick?: (tag: string) => void;
}

/**
 * Column grid matching the ScheduleCalendar's layout, adapted for the dial:
 * Mobile:  play | show | genre | right-rail
 * sm+:     play | station | show | genre | right-rail
 */
const DIAL_ROW_GRID =
  "grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,9rem)_auto] sm:grid-cols-[3.5rem_7.5rem_minmax(0,1fr)_minmax(0,11rem)_auto] items-start gap-x-3 px-3 pr-4";

export function StationList({
  stations,
  activeSlug,
  status,
  pulse,
  picked,
  schedule,
  recentSpins,
  availability,
  featured = false,
  currentShow,
  onToggle,
  onSelect,
  onGenreClick,
}: StationListProps) {
  return (
    <ul className="flex flex-col gap-0" data-testid="station-list">
      {stations.map((station) => {
        const isActive = station.slug === activeSlug;
        const isPlaying = isActive && status === "playing";
        const isLoading = isActive && status === "loading";
        const np = pulse?.get(station.slug) ?? null;
        const pick = picked?.get(station.slug) ?? null;
        const runs = schedule?.get(station.slug) ?? null;
        const spins = recentSpins?.get(station.slug) ?? null;
        const scrapedNow = currentShow?.get(station.slug) ?? null;
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
        const hasStream = Boolean(station.streamUrl);

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
              className={`hover-elevate group rounded-xl border transition-colors ${
                isActive
                  ? "border-primary-border bg-primary/[0.06]"
                  : "border-card-border bg-card"
              }`}
            >
              {/* ── Main grid row ── */}
              <div className={`${DIAL_ROW_GRID} py-2.5`}>

                {/* Col 1: Play button / archive link — EQ replaces icon when playing */}
                <div className="flex items-center justify-center pt-0.5">
                  {hasStream ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(station);
                      }}
                      aria-label={isPlaying ? `Pause ${station.name}` : `Play ${station.name}`}
                      data-testid={`toggle-${station.slug}`}
                      className={`relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border shadow-sm transition-transform active:scale-95 ${
                        artwork
                          ? "border-border bg-muted"
                          : "border-primary-border bg-primary text-primary-foreground"
                      }`}
                    >
                      {artwork && (
                        <>
                          <img
                            src={proxyArtUrl(artwork)!}
                            alt=""
                            aria-hidden
                            className="absolute inset-0 h-full w-full object-cover"
                            data-testid={`pulse-artwork-${station.slug}`}
                          />
                          <span className="absolute inset-0 bg-black/35 transition-colors group-hover:bg-black/45" />
                        </>
                      )}
                      <span className={`relative ${artwork ? "text-white drop-shadow" : ""}`}>
                        {isLoading ? (
                          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                        ) : isPlaying ? (
                          /* EQ bars replace the pause icon when live */
                          <span className="flex h-4 items-end gap-[2px]" aria-hidden>
                            {[0, 1, 2].map((i) => (
                              <span
                                key={i}
                                className="lore-eq-bar w-[2px] bg-current"
                                style={{ height: "12px", animationDelay: `${i * 140}ms` }}
                              />
                            ))}
                          </span>
                        ) : (
                          <Play className="ml-0.5 h-4 w-4 fill-current" />
                        )}
                      </span>
                    </button>
                  ) : (
                    <Link
                      href={`/stations/${station.slug}/archive`}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Browse ${station.name} archive`}
                      data-testid={`archive-link-${station.slug}`}
                      title="No live stream — browse archive"
                      className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground/50 shadow-sm transition-colors hover:border-primary/30 hover:text-muted-foreground"
                    >
                      <BookOpen className="h-4 w-4" />
                    </Link>
                  )}
                </div>

                {/* Col 2: Station name + external link — hidden on mobile */}
                <div className="hidden sm:flex min-w-0 flex-col justify-center pt-1">
                  {featured ? (
                    <Link
                      href={`/archive/stations/${station.slug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate font-serif text-sm font-semibold leading-tight text-foreground hover:text-primary transition-colors"
                      data-testid={`featured-station-link-${station.slug}`}
                    >
                      {station.name}
                    </Link>
                  ) : (
                    <h3 className="truncate font-serif text-sm font-semibold leading-tight text-foreground">
                      {station.name}
                    </h3>
                  )}
                  {safeHttpUrl(station.homepageUrl) && (
                    <a
                      href={safeHttpUrl(station.homepageUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Visit ${station.name}'s homepage`}
                      title={station.homepageUrl ?? undefined}
                      data-testid={`homepage-link-${station.slug}`}
                      className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/50 transition-colors hover:text-primary"
                    >
                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">site</span>
                    </a>
                  )}
                </div>

                {/* Col 3: Now-playing / show / DJ block + metadata chips + timelines */}
                <div className="min-w-0 overflow-hidden pt-0.5">
                  {/* Station name shown on mobile (col 2 is hidden) */}
                  <div className="flex sm:hidden items-center gap-1.5 mb-0.5">
                    {featured ? (
                      <Link
                        href={`/archive/stations/${station.slug}`}
                        onClick={(e) => e.stopPropagation()}
                        className="truncate font-serif text-sm font-semibold leading-tight text-foreground hover:text-primary transition-colors"
                        data-testid={`featured-station-link-mobile-${station.slug}`}
                      >
                        {station.name}
                      </Link>
                    ) : (
                      <span className="truncate font-serif text-sm font-semibold leading-tight text-foreground">
                        {station.name}
                      </span>
                    )}
                    {safeHttpUrl(station.homepageUrl) && (
                      <a
                        href={safeHttpUrl(station.homepageUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Visit ${station.name}'s homepage`}
                        className="shrink-0 text-muted-foreground/50 transition-colors hover:text-primary"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Primary track / show line */}
                  {trackLine ? (
                    <p
                      className="truncate text-xs text-foreground/80"
                      data-testid={`pulse-track-${station.slug}`}
                    >
                      {trackLine}
                    </p>
                  ) : np?.show ? (
                    <p
                      className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                      data-testid={`pulse-show-${station.slug}`}
                    >
                      <Mic className="h-3 w-3 shrink-0 text-primary/70" />
                      {np.show.djName ? (
                        <>
                          <Link
                            href={`/dj/${encodeURIComponent(np.show.djName)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary hover:underline truncate"
                          >
                            {np.show.djName}
                          </Link>
                          {" · "}
                          <span className="truncate">{np.show.name}</span>
                        </>
                      ) : (
                        <span className="truncate">{np.show.name}</span>
                      )}
                    </p>
                  ) : scrapedNow ? (
                    <p
                      className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                      data-testid={`scraped-now-${station.slug}`}
                    >
                      <Mic className="h-3 w-3 shrink-0 text-primary/70" />
                      {scrapedNow.djName ? (
                        <>
                          <Link
                            href={`/dj/${encodeURIComponent(scrapedNow.djName)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary hover:underline truncate"
                          >
                            {scrapedNow.djName}
                          </Link>
                          {" · "}
                          <span className="truncate">{scrapedNow.showName}</span>
                        </>
                      ) : (
                        <span className="truncate">{scrapedNow.showName}</span>
                      )}
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                      <Radio className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        {[station.org, station.city, station.country].filter(Boolean).join(" · ") || "Independent"}
                      </span>
                    </p>
                  )}

                  {/* Show attribution below track line when both are present */}
                  {np?.show && trackLine && (
                    <p
                      className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                      data-testid={`pulse-show-${station.slug}`}
                    >
                      <Mic className="h-3 w-3 shrink-0 text-primary/70" />
                      {np.show.djName ? (
                        <>
                          <Link
                            href={`/dj/${encodeURIComponent(np.show.djName)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary hover:underline truncate"
                          >
                            {np.show.djName}
                          </Link>
                          {" · "}
                          <span className="truncate">{np.show.name}</span>
                        </>
                      ) : (
                        <span className="truncate">{np.show.name}</span>
                      )}
                    </p>
                  )}

                  {/* Picker badge — inline in now-playing column */}
                  {pick &&
                    (pick.runId != null ? (
                      <Link
                        href={`/archive/selector-runs/${pick.runId}`}
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
                        <span className="truncate">{pick.picker.name} pick</span>
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
                        <span className="truncate">{pick.picker.name} pick</span>
                      </span>
                    ))}

                  {/* May-have-ads badge — inline in now-playing column */}
                  {station.mayHaveAds && (
                    <span
                      className="mt-1 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
                      title="This station has been observed airing ad breaks"
                      data-testid={`ads-badge-${station.slug}`}
                    >
                      <Volume2 className="h-2.5 w-2.5 shrink-0" />
                      May have ads
                    </span>
                  )}

                  {/* Metadata availability chips */}
                  {avail && (avail.hasLyrics || avail.hasSe) && (
                    <div
                      className="mt-1 flex gap-1 overflow-x-auto"
                      style={{ scrollbarWidth: "none" }}
                    >
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

                  {/* Timeline strip — track chips for showless, show blocks for named stations */}
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

                {/* Col 4: Genre chips */}
                <div className="flex min-w-0 flex-wrap gap-1 pt-1">
                  {(station.tags ?? []).slice(0, 3).map((tag, gi) =>
                    onGenreClick ? (
                      <button
                        key={tag}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onGenreClick(tag);
                        }}
                        data-testid={`genre-tag-${station.slug}-${tag}`}
                        className={`inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[9px] text-muted-foreground/70 whitespace-nowrap hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer ${gi >= 2 ? "hidden sm:inline-flex" : ""}`}
                      >
                        <span className="truncate max-w-[9ch]">{tag}</span>
                      </button>
                    ) : (
                      <span
                        key={tag}
                        className={`inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[9px] text-muted-foreground/70 whitespace-nowrap ${gi >= 2 ? "hidden sm:inline-flex" : ""}`}
                      >
                        <span className="truncate max-w-[9ch]">{tag}</span>
                      </span>
                    )
                  )}
                </div>

                {/* Col 5: Right rail — quality badge (stacked, items-end) */}
                <div
                  className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <QualityBadge quality={station.streamQuality} format={station.streamFormat} />
                  {(station.qualityTier === "silent" || station.qualityTier === "unscored") && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/50"
                      title={
                        station.qualityTier === "silent"
                          ? "Active stream but near-zero usable track metadata in the last 7 days"
                          : "Fewer than 20 logged spins in the last 7 days — not enough data to evaluate"
                      }
                      data-testid={`low-signal-badge-${station.slug}`}
                    >
                      <Info className="h-2.5 w-2.5 shrink-0" />
                      Low signal
                    </span>
                  )}
                </div>
              </div>

              {/* Full-width expansion for featured mode — blurb + upcoming shows */}
              {featured && (
                <div className="px-3 pb-2.5 pl-[calc(3.5rem+0.75rem+3px)]">
                  {station.homepageBlurb && (
                    <p className="line-clamp-2 text-xs text-muted-foreground/70">
                      {station.homepageBlurb}
                    </p>
                  )}
                  <UpcomingShowStrip slug={station.slug} />
                </div>
              )}
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
  // Only mark a run active when it genuinely overlaps the current window (started
  // already and ended no more than 4 hours ago).  The previous fallback to
  // runs[runs.length - 1] caused stale runs that ended hours ago to appear
  // "live" and show the Play icon to listeners who opened the page long after
  // the station had gone off air.
  const activeRunId = runs.find(
    (r) =>
      new Date(r.startedAt).getTime() <= now &&
      new Date(r.endedAt).getTime() >= now - 4 * 60 * 60 * 1000,
  )?.runId;

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
            {(replayable || isActive) && (
              <Play className="h-2 w-2 shrink-0 fill-current" />
            )}
            <span className="max-w-[12ch] truncate">{label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** UTC day-of-week index (Sun=0 … Sat=6) for scraped day abbreviations. */
const DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Minutes from now (UTC) until the next occurrence of a weekly slot.
 * Always returns a positive number 0 < result ≤ 10080 (one week).
 */
function minutesUntilSlot(dayOfWeek: string, startTime: string): number {
  const now = new Date();
  const nowDayIdx = now.getUTCDay();
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const slotDayIdx = DAY_INDEX[dayOfWeek] ?? 0;
  const [h, m] = startTime.split(":").map(Number);
  const slotMinutes = h * 60 + (m || 0);
  let daysDiff = slotDayIdx - nowDayIdx;
  if (daysDiff < 0 || (daysDiff === 0 && slotMinutes <= nowMinutes)) {
    daysDiff += 7;
  }
  return daysDiff * 24 * 60 + (slotMinutes - nowMinutes);
}

/**
 * Lazy-loaded upcoming show strip for Featured mode. Fetches the station's
 * weekly scraped schedule, sorts slots by time-until-next-occurrence (UTC),
 * and renders the soonest unique slots as clickable chips.
 */
function UpcomingShowStrip({ slug }: { slug: string }) {
  const { data } = useGetStationUpcomingSchedule(slug, {
    query: {
      queryKey: getGetStationUpcomingScheduleQueryKey(slug),
      staleTime: 10 * 60 * 1000,
    },
  });

  const shows = data?.shows ?? [];
  if (shows.length === 0) return null;

  const sorted = [...shows].sort(
    (a, b) =>
      minutesUntilSlot(a.dayOfWeek, a.startTime) -
      minutesUntilSlot(b.dayOfWeek, b.startTime),
  );
  const upcoming = sorted.slice(0, 5);

  return (
    <div
      className="mt-2 flex flex-wrap gap-1.5"
      onClick={(e) => e.stopPropagation()}
      data-testid={`upcoming-shows-${slug}`}
    >
      {upcoming.map((show, i) => (
        <span key={`${show.showName}-${show.dayOfWeek}-${i}`} className="flex items-center gap-1">
          <Link
            href={`/archive/stations/${slug}?show=${encodeURIComponent(show.showName)}`}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-foreground/80 hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors whitespace-nowrap"
            title={`${show.dayOfWeek} ${show.startTime} — browse archive`}
            data-testid={`show-chip-featured-${slug}-${show.showName}`}
          >
            <BookOpen className="h-2.5 w-2.5 shrink-0" />
            <span className="max-w-[14ch] truncate">{show.showName}</span>
            <span className="text-muted-foreground/50">{show.dayOfWeek}</span>
          </Link>
          {show.djName && (
            <Link
              href={`/dj/${encodeURIComponent(show.djName)}`}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors whitespace-nowrap"
              title={`${show.djName}'s schedule`}
              data-testid={`dj-chip-featured-${slug}-${show.djName}`}
            >
              <Mic className="h-2.5 w-2.5 shrink-0" />
              <span className="max-w-[10ch] truncate">{show.djName}</span>
            </Link>
          )}
        </span>
      ))}
    </div>
  );
}
