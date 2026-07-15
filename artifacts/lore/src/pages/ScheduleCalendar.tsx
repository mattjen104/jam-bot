import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Mic,
  Radio,
  Sparkles,
} from "lucide-react";
import {
  useGetAllScrapedShows,
  useGetStationsRollingGenres,
} from "@workspace/api-client-react";
import type { RollingGenreChip } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  toMinutes,
  isSlotLive,
  isOvernightCarryoverLive,
} from "../lib/scheduleLive";
import { useScheduleSampler } from "../hooks/useScheduleSampler";

const DOW_TO_IDX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const SHORT_MONTH = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];
const FULL_DAY = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
];

function formatDateHeading(d: Date) {
  return `${FULL_DAY[d.getDay()]}, ${SHORT_MONTH[d.getMonth()]} ${d.getDate()}`;
}

function localDateKey(d: Date) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

type ShowEntry = {
  stationSlug: string;
  stationName: string;
  showName: string;
  startTime: string;
  endTime: string | null;
  djName: string | null;
};

export default function ScheduleCalendar() {
  const [stationFilter, setStationFilter] = useState("all");
  // 0 = live-first view anchored on "now"; negative = days back in time.
  const [offsetDays, setOffsetDays] = useState(0);
  const { data, isLoading } = useGetAllScrapedShows();
  const { data: rollingData } = useGetStationsRollingGenres();
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";
  const { onSlotEnter, onSlotLeave, isSlotActive } = useScheduleSampler();

  const stations = data?.stations ?? [];
  const rollingByStation: Record<string, RollingGenreChip[]> =
    rollingData?.stations ?? {};

  // "Now" is computed once per render pass; the page is navigational, not a
  // ticking clock, so no interval re-render is needed.
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const dates = useMemo(() => {
    const list: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(todayMs);
      d.setDate(d.getDate() + offsetDays + i);
      list.push(d);
    }
    return list;
  }, [offsetDays, todayMs]);

  const byDate = useMemo(() => {
    const filtered =
      stationFilter === "all"
        ? stations
        : stations.filter((s) => s.slug === stationFilter);

    const map = new Map<string, ShowEntry[]>();
    for (const date of dates) {
      map.set(localDateKey(date), []);
    }

    for (const station of filtered) {
      for (const show of station.shows) {
        const dowIdx = DOW_TO_IDX[show.dayOfWeek];
        if (dowIdx === undefined) continue;
        for (const date of dates) {
          if (date.getDay() === dowIdx) {
            map.get(localDateKey(date))!.push({
              stationSlug: station.slug,
              stationName: station.name,
              showName: show.showName,
              startTime: show.startTime,
              endTime: show.endTime ?? null,
              djName: show.djName ?? null,
            });
          }
        }
      }
    }

    for (const arr of map.values()) {
      arr.sort(
        (a, b) =>
          a.startTime.localeCompare(b.startTime) ||
          a.stationName.localeCompare(b.stationName),
      );
    }

    return map;
  }, [stations, stationFilter, dates]);

  // Live-first split: only meaningful in the default (offset 0) view.
  const todayKey = localDateKey(today);
  const isLiveView = offsetDays === 0;
  const { liveNow, upcomingToday } = useMemo(() => {
    if (!isLiveView) return { liveNow: [], upcomingToday: [] };
    const todaySlots = byDate.get(todayKey) ?? [];
    const live: ShowEntry[] = [];
    const upcoming: ShowEntry[] = [];
    for (const s of todaySlots) {
      if (isSlotLive(s.startTime, s.endTime, nowMins)) live.push(s);
      else {
        const start = toMinutes(s.startTime);
        if (start != null && start > nowMins) upcoming.push(s);
        // Earlier-today slots are reachable via the "Earlier" control.
      }
    }

    // Overnight carryover: a slot from *yesterday's* grid that crosses
    // midnight (e.g. Sat 23:00–02:00) is still on the air in today's early
    // hours, but only appears under yesterday's dayOfWeek.
    const yesterdayDow = (today.getDay() + 6) % 7;
    const filtered =
      stationFilter === "all"
        ? stations
        : stations.filter((st) => st.slug === stationFilter);
    for (const station of filtered) {
      for (const show of station.shows) {
        if (DOW_TO_IDX[show.dayOfWeek] !== yesterdayDow) continue;
        if (!isOvernightCarryoverLive(show.startTime, show.endTime ?? null, nowMins)) continue;
        live.push({
          stationSlug: station.slug,
          stationName: station.name,
          showName: show.showName,
          startTime: show.startTime,
          endTime: show.endTime ?? null,
          djName: show.djName ?? null,
        });
      }
    }
    live.sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.stationName.localeCompare(b.stationName),
    );

    return { liveNow: live, upcomingToday: upcoming };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDate, todayKey, nowMins, isLiveView, stations, stationFilter]);

  const totalSlots = useMemo(() => {
    let n = 0;
    for (const arr of byDate.values()) n += arr.length;
    return n;
  }, [byDate]);

  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => a.name.localeCompare(b.name)),
    [stations],
  );

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          The dial
        </Link>

        <header className="mb-6 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <CalendarDays className="h-4 w-4" />
            Schedule
          </div>
          <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground">
            {isLiveView ? "On the air" : formatDateHeading(dates[0]!)}
          </h1>
          {!isLoading && stations.length > 0 && (
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {totalSlots.toLocaleString()} show slots across{" "}
              {stationFilter === "all"
                ? `${stations.length} stations`
                : sortedStations.find((s) => s.slug === stationFilter)?.name ??
                  "station"}
            </p>
          )}
        </header>

        {/* Controls: station filter + time navigation */}
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {stations.length > 0 && (
            <select
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
            >
              <option value="all">All {stations.length} stations</option>
              {sortedStations.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setOffsetDays((d) => d - 1)}
              data-testid="schedule-earlier"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              title="Step one day earlier"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Earlier
            </button>
            {!isLiveView && (
              <button
                type="button"
                onClick={() => setOffsetDays(0)}
                data-testid="schedule-now"
                className="inline-flex items-center gap-1 rounded-lg border border-primary-border bg-primary/10 px-2.5 py-2 font-mono text-[11px] uppercase tracking-wide text-primary hover:bg-primary/20 transition-colors"
              >
                Now
              </button>
            )}
            <button
              type="button"
              onClick={() => setOffsetDays((d) => d + 1)}
              data-testid="schedule-later"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-2 font-mono text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
              title="Step one day later"
            >
              Later
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl border border-card-border bg-card"
              />
            ))}
          </div>
        )}

        {!isLoading && (
          <div className="space-y-8">
            {/* Live now — pinned at the top in the default view */}
            {isLiveView && liveNow.length > 0 && (
              <section data-testid="live-now-section">
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="flex items-center gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    <span className="relative flex h-2 w-2" aria-hidden>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                    </span>
                    Live radio
                  </h2>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {liveNow.length} on the air
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-red-500/25 bg-card">
                  <ColumnHeader />
                  {liveNow.map((show, i) => (
                    <SlotRow
                      key={`${show.stationSlug}-${show.showName}-${show.startTime}-${i}`}
                      show={show}
                      rollingChips={rollingByStation[show.stationSlug]}
                      isLast={i === liveNow.length - 1}
                      live
                      isSampling={isSlotActive(show.stationSlug, todayKey, show.startTime)}
                      onMouseEnter={() => onSlotEnter(
                        show.stationSlug,
                        todayKey,
                        show.startTime,
                        DOW_NAMES[today.getDay()] ?? "Mon",
                        show.endTime,
                      )}
                      onMouseLeave={onSlotLeave}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Rest of today (upcoming) in live view */}
            {isLiveView && upcomingToday.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
                    Later today
                  </h2>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {upcomingToday.length} shows
                  </span>
                </div>
                <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                  <ColumnHeader />
                  {upcomingToday.map((show, i) => (
                    <SlotRow
                      key={`${show.stationSlug}-${show.showName}-${show.startTime}-${i}`}
                      show={show}
                      rollingChips={rollingByStation[show.stationSlug]}
                      isLast={i === upcomingToday.length - 1}
                      isSampling={isSlotActive(show.stationSlug, todayKey, show.startTime)}
                      onMouseEnter={() => onSlotEnter(
                        show.stationSlug,
                        todayKey,
                        show.startTime,
                        DOW_NAMES[today.getDay()] ?? "Mon",
                        show.endTime,
                      )}
                      onMouseLeave={onSlotLeave}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Day-by-day grid: in live view, skip today (already split above) */}
            {dates.map((date) => {
              const key = localDateKey(date);
              if (isLiveView && key === todayKey) return null;
              const shows = byDate.get(key) ?? [];
              if (shows.length === 0) return null;
              const isToday = key === todayKey;
              const isPast = date.getTime() < todayMs;
              return (
                <section key={key} id={key}>
                  <div className="mb-2 flex items-center gap-3">
                    <h2 className={`font-mono text-[11px] font-semibold uppercase tracking-wider ${isPast ? "text-muted-foreground" : "text-foreground"}`}>
                      {formatDateHeading(date)}
                    </h2>
                    {isToday && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
                        today
                      </span>
                    )}
                    {isPast && (
                      <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                        past
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {shows.length} shows
                    </span>
                  </div>

                  <div className={`overflow-hidden rounded-xl border border-card-border bg-card ${isPast ? "opacity-70" : ""}`}>
                    <ColumnHeader />
                    {shows.map((show, i) => (
                      <SlotRow
                        key={`${show.stationSlug}-${show.showName}-${show.startTime}-${i}`}
                        show={show}
                        rollingChips={rollingByStation[show.stationSlug]}
                        isLast={i === shows.length - 1}
                        live={isToday && isSlotLive(show.startTime, show.endTime, nowMins)}
                        isSampling={isSlotActive(show.stationSlug, key, show.startTime)}
                        onMouseEnter={() => onSlotEnter(
                          show.stationSlug,
                          key,
                          show.startTime,
                          DOW_NAMES[date.getDay()] ?? "Mon",
                          show.endTime,
                        )}
                        onMouseLeave={onSlotLeave}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {totalSlots === 0 && !isLoading && (
              <div className="rounded-xl border border-border bg-card p-8 text-center font-mono text-sm text-muted-foreground">
                No shows found for this selection.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Shared column template so header + rows stay aligned.
 * Mobile:  time | show | genre | discovery
 * sm+:     time | station | show | genre | discovery
 * md+:     time | station | show+DJ | wider genre | discovery
 */
const ROW_GRID =
  "grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,6.5rem)_3.25rem] sm:grid-cols-[3rem_7.5rem_minmax(0,1fr)_minmax(0,9rem)_3.5rem] md:grid-cols-[3rem_7.5rem_minmax(0,1fr)_minmax(0,13rem)_3.75rem] items-center gap-x-3 px-4";

/** Column header row for a schedule section. */
function ColumnHeader() {
  return (
    <div
      className={`${ROW_GRID} border-b border-border/60 bg-background/40 py-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60`}
    >
      <span>Time</span>
      <span className="hidden sm:block">Station</span>
      <span>Show</span>
      <span>Recent plays</span>
      <span className="text-right" title="Discovery tier derived from the most recently-played song's release year">
        Era
      </span>
    </div>
  );
}

/**
 * Discovery era cell: label badge from the newest rolling chip that has a
 * non-null discoveryLabel. "—" when no rolling data is available yet.
 */
function DiscoveryEraCell({ chips }: { chips: RollingGenreChip[] | undefined }) {
  const label = chips?.find((c) => c.discoveryLabel != null)?.discoveryLabel ?? null;

  if (!label) {
    return (
      <span className="text-right font-mono text-[10px] text-muted-foreground/40">
        —
      </span>
    );
  }

  const isNew = label === "new-music";
  const tone =
    label === "new-music"
      ? "text-primary"
      : label === "recent"
        ? "text-foreground"
        : "text-muted-foreground/70";
  const shortLabel =
    label === "new-music" ? "new" : label === "recent" ? "recent" : "catalog";
  const title =
    label === "new-music"
      ? "Recent release — within the last 3 years"
      : label === "recent"
        ? "Modern — within the last 10 years"
        : "Catalog — older than 10 years";

  return (
    <span
      className={`inline-flex items-center justify-end gap-1 text-right font-mono text-[10px] ${tone}`}
      title={title}
      data-testid={`discovery-era-label`}
    >
      {isNew && <Sparkles className="h-2.5 w-2.5 shrink-0" />}
      {shortLabel}
    </span>
  );
}

/** Tiny waveform bars shown next to the show name while the sampler is active. */
function ScanningIndicator() {
  return (
    <span
      className="inline-flex shrink-0 items-end gap-px"
      style={{ height: "10px" }}
      aria-label="Sampling audio"
      role="img"
    >
      {[0, 150, 75, 225].map((delay) => (
        <span
          key={delay}
          className="lore-sampler-bar inline-block w-[2px] rounded-sm bg-primary"
          style={{ height: "10px", animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/** One schedule slot row: time, station, show, DJ, rolling genre chips, era. */
function SlotRow({
  show,
  rollingChips,
  isLast,
  live = false,
  isSampling = false,
  onMouseEnter,
  onMouseLeave,
}: {
  show: ShowEntry;
  rollingChips: RollingGenreChip[] | undefined;
  isLast: boolean;
  live?: boolean;
  isSampling?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  // Newest chip determines row highlight — only if it's brand-new music.
  const newestLabel = rollingChips?.[0]?.discoveryLabel ?? null;
  const isNewMusic = newestLabel === "new-music";

  return (
    <div
      className={`${ROW_GRID} py-2.5${
        isLast ? "" : " border-b border-border/40"
      }${isNewMusic ? " bg-primary/[0.04]" : ""}${isSampling ? " bg-primary/[0.06]" : ""}`}
      data-testid={`slot-${show.stationSlug}-${show.startTime}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Time or LIVE badge */}
      {live ? (
        <span
          className="inline-flex items-center gap-1 font-mono text-[9px] font-semibold uppercase tracking-wide text-red-500"
          data-testid="live-badge"
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
          </span>
          Live
        </span>
      ) : (
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {show.startTime}
        </span>
      )}

      {/* Station badge — hidden on tiny screens */}
      <Link
        href={`/archive/stations/${show.stationSlug}`}
        onClick={(e) => e.stopPropagation()}
        className="hidden sm:inline-flex min-w-0 items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[9px] text-muted-foreground/70 hover:border-primary/40 hover:text-primary transition-colors overflow-hidden"
        title={show.stationName}
      >
        <Radio className="h-2 w-2 shrink-0" />
        <span className="truncate">{show.stationName}</span>
      </Link>

      {/* Show name + DJ + scanning indicator */}
      <span className="flex min-w-0 items-center gap-2">
        <Link
          href={`/archive/stations/${show.stationSlug}?show=${encodeURIComponent(show.showName)}`}
          className="min-w-0 truncate font-mono text-[11px] text-foreground hover:text-primary transition-colors"
          title={show.showName}
        >
          {show.showName}
        </Link>
        {isSampling && <ScanningIndicator />}
        {show.djName && (
          <Link
            href={`/dj/${encodeURIComponent(show.djName)}`}
            onClick={(e) => e.stopPropagation()}
            className="hidden md:inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/70 hover:text-primary transition-colors"
            title={`${show.djName}'s schedule`}
          >
            <Mic className="h-2.5 w-2.5 shrink-0" />
            <span className="max-w-[12ch] truncate">{show.djName}</span>
          </Link>
        )}
      </span>

      {/* Rolling genre chips: oldest left, newest right (most prominent).
          chips[0] = newest, so we reverse before rendering. */}
      {rollingChips && rollingChips.length > 0 ? (
        <span
          className="flex min-w-0 gap-1 overflow-hidden"
          title={[...rollingChips].reverse().map((c) => c.genre).join(" → ")}
        >
          {[...rollingChips].reverse().map((chip, gi, arr) => {
            const isNewest = gi === arr.length - 1;
            return (
              <span
                key={chip.playedAt}
                className={`inline-flex min-w-0 items-center rounded-full border px-2 py-0.5 font-mono text-[9px] whitespace-nowrap ${
                  isNewest
                    ? "border-border bg-background/40 text-muted-foreground/70"
                    : "border-border/40 bg-background/20 text-muted-foreground/35"
                } ${gi === 0 ? "hidden md:inline-flex" : gi === 1 ? "hidden sm:inline-flex" : ""}`}
              >
                <span className="truncate">{chip.genre}</span>
              </span>
            );
          })}
        </span>
      ) : (
        <span className="font-mono text-[10px] text-muted-foreground/40">—</span>
      )}

      {/* Era / discovery column */}
      <DiscoveryEraCell chips={rollingChips} />
    </div>
  );
}
