import { Link } from "wouter";
import type {
  NowPlaying,
  PickedLookupItem,
  RecordingAvailabilityItem,
  ScrapedShowItem,
  Station,
  StationRecentSpin,
  StationScheduleRun,
} from "@workspace/api-client-react";
import {
  useGetStationUpcomingSchedule,
  getGetStationUpcomingScheduleQueryKey,
} from "@workspace/api-client-react";
import { QualityBadge } from "./QualityBadge";
import { FollowButton } from "./FollowButton";
import { BadgeCheck, BookOpen, ExternalLink, Mic, Mic2, Music2, Pause, Play, Radio, Volume2 } from "lucide-react";
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
    <ul className="flex flex-col gap-2" data-testid="station-list">
      {stations.map((station) => {
        const isActive = station.slug === activeSlug;
        const isPlaying = isActive && status === "playing";
        const isLoading = isActive && status === "loading";
        const np = pulse?.get(station.slug) ?? null;
        const pick = picked?.get(station.slug) ?? null;
        const runs = schedule?.get(station.slug) ?? null;
        const spins = recentSpins?.get(station.slug) ?? null;
        const scrapedNow = currentShow?.get(station.slug) ?? null;
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
              className={`hover-elevate group flex items-center gap-4 rounded-xl border p-3 pr-4 transition-colors ${
                isActive
                  ? "border-primary-border bg-primary/[0.06]"
                  : "border-card-border bg-card"
              }`}
            >
              {hasStream ? (
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
              ) : (
                /* No live stream — link to archive instead of a broken play button */
                <Link
                  href={`/stations/${station.slug}/archive`}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Browse ${station.name} archive`}
                  data-testid={`archive-link-${station.slug}`}
                  title="No live stream — browse archive"
                  className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground/50 shadow-sm transition-colors hover:border-primary/30 hover:text-muted-foreground"
                >
                  <BookOpen className="h-4 w-4" />
                </Link>
              )}

              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-2">
                  {featured ? (
                    <Link
                      href={`/archive/stations/${station.slug}`}
                      onClick={(e) => e.stopPropagation()}
                      className="truncate font-serif text-lg font-semibold leading-tight text-foreground hover:text-primary transition-colors"
                      data-testid={`featured-station-link-${station.slug}`}
                    >
                      {station.name}
                    </Link>
                  ) : (
                    <h3 className="truncate font-serif text-lg font-semibold leading-tight text-foreground">
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
                      className="shrink-0 text-muted-foreground/60 transition-colors hover:text-primary"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
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
                ) : np?.show ? (
                  /* No resolved track but show is known — surface show name
                     in the primary subtitle slot so it's visible on the dial. */
                  <p
                    className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                    data-testid={`pulse-show-${station.slug}`}
                  >
                    <Mic className="h-3 w-3 text-primary/70" />
                    {np.show.djName ? (
                      <>
                        <Link
                          href={`/dj/${encodeURIComponent(np.show.djName)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-primary hover:underline"
                        >
                          {np.show.djName}
                        </Link>
                        {" · "}
                        {np.show.name}
                      </>
                    ) : (
                      np.show.name
                    )}
                  </p>
                ) : scrapedNow ? (
                  <p
                    className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                    data-testid={`scraped-now-${station.slug}`}
                  >
                    <Mic className="h-3 w-3 text-primary/70" />
                    {scrapedNow.djName ? (
                      <>
                        <Link
                          href={`/dj/${encodeURIComponent(scrapedNow.djName)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-primary hover:underline"
                        >
                          {scrapedNow.djName}
                        </Link>
                        {" · "}
                        {scrapedNow.showName}
                      </>
                    ) : (
                      scrapedNow.showName
                    )}
                  </p>
                ) : (
                  <p className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground">
                    <Radio className="h-3 w-3" />
                    {[station.org, station.country].filter(Boolean).join(" · ") ||
                      "Independent"}
                  </p>
                )}
                {/* Featured metadata — always shown in featured mode regardless of now-playing state */}
                {featured && (
                  <>
                    {station.homepageBlurb && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/70">
                        {station.homepageBlurb}
                      </p>
                    )}
                    {station.tags && station.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {station.tags.slice(0, 5).map((tag) =>
                          onGenreClick ? (
                            <button
                              key={tag}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onGenreClick(tag);
                              }}
                              data-testid={`genre-tag-${station.slug}-${tag}`}
                              className="inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer"
                            >
                              {tag}
                            </button>
                          ) : (
                            <span
                              key={tag}
                              className="inline-flex items-center rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70 whitespace-nowrap"
                            >
                              {tag}
                            </span>
                          )
                        )}
                      </div>
                    )}
                  </>
                )}
                {/* Show attribution below track line only when both are present */}
                {np?.show && trackLine && (
                  <p
                    className="mt-0.5 flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                    data-testid={`pulse-show-${station.slug}`}
                  >
                    <Mic className="h-3 w-3 text-primary/70" />
                    {np.show.djName ? (
                      <>
                        <Link
                          href={`/dj/${encodeURIComponent(np.show.djName)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hover:text-primary hover:underline"
                        >
                          {np.show.djName}
                        </Link>
                        {" · "}
                        {np.show.name}
                      </>
                    ) : (
                      np.show.name
                    )}
                  </p>
                )}
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

                {/* Featured-mode upcoming shows strip */}
                {featured && (
                  <UpcomingShowStrip slug={station.slug} />
                )}
              </div>

              {/* Right rail: follow station, quality badge */}
              <div
                className="flex shrink-0 flex-col items-end gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <FollowButton kind="station" id={station.slug} name={station.name} />
                <QualityBadge quality={station.streamQuality} format={station.streamFormat} />
                {station.mayHaveAds && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
                    title="This station has been observed airing ad breaks"
                    data-testid={`ads-badge-${station.slug}`}
                  >
                    <Volume2 className="h-2.5 w-2.5 shrink-0" />
                    May have ads
                  </span>
                )}
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
 * and renders the soonest unique slots as clickable chips:
 *   - Show name chip → station archive (filtered by show)
 *   - DJ name chip → /dj/:name
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

  // Sort every slot by proximity to now, then pick the 5 soonest.
  // A show that runs Mon + Thu will appear as two chips (both occurrences).
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
