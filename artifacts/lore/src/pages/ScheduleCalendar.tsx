import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ArrowLeft, CalendarDays, Mic, Radio } from "lucide-react";
import { useGetAllScrapedShows } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";

const DOW_TO_IDX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const SHORT_MONTH = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];
const FULL_DAY = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
];
const SHORT_DAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function formatDateHeading(d: Date) {
  return `${FULL_DAY[d.getDay()]}, ${SHORT_MONTH[d.getMonth()]} ${d.getDate()}`;
}

function getDatesBetween(from: Date, to: Date): Date[] {
  const dates: Date[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d <= end) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return dates;
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
  const { data, isLoading } = useGetAllScrapedShows();
  const { ride, radio } = usePlayer();
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  const stations = data?.stations ?? [];

  const { dates, toDate } = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const july31 = new Date(2026, 6, 31);
    const july11 = new Date(2026, 6, 11);
    const from =
      today.getFullYear() === 2026 &&
      today.getMonth() === 6 &&
      today.getDate() >= 11
        ? today
        : july11;
    return { dates: getDatesBetween(from, july31), toDate: july31 };
  }, []);

  const byDate = useMemo(() => {
    const filtered =
      stationFilter === "all"
        ? stations
        : stations.filter((s) => s.slug === stationFilter);

    const map = new Map<string, ShowEntry[]>();
    for (const date of dates) {
      map.set(date.toISOString().slice(0, 10), []);
    }

    for (const station of filtered) {
      for (const show of station.shows) {
        const dowIdx = DOW_TO_IDX[show.dayOfWeek];
        if (dowIdx === undefined) continue;
        for (const date of dates) {
          if (date.getDay() === dowIdx) {
            const key = date.toISOString().slice(0, 10);
            map.get(key)!.push({
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
            Rest of July
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

        {/* Station filter */}
        {stations.length > 0 && (
          <div className="mb-6">
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
          </div>
        )}

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
            {dates.map((date) => {
              const key = date.toISOString().slice(0, 10);
              const shows = byDate.get(key) ?? [];
              if (shows.length === 0) return null;
              const isToday =
                date.toISOString().slice(0, 10) ===
                new Date().toISOString().slice(0, 10);
              return (
                <section key={key} id={key}>
                  <div className="mb-2 flex items-center gap-3">
                    <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground">
                      {formatDateHeading(date)}
                    </h2>
                    {isToday && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
                        today
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {shows.length} shows
                    </span>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card overflow-hidden">
                    {shows.map((show, i) => (
                      <div
                        key={`${show.stationSlug}-${show.showName}-${show.startTime}-${i}`}
                        className={`flex items-center gap-3 px-4 py-2.5${
                          i < shows.length - 1
                            ? " border-b border-border/40"
                            : ""
                        }`}
                      >
                        {/* Time */}
                        <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                          {show.startTime}
                        </span>

                        {/* Station badge — hidden on tiny screens */}
                        <Link
                          href={`/archive/stations/${show.stationSlug}`}
                          onClick={(e) => e.stopPropagation()}
                          className="hidden sm:inline-flex w-[11ch] shrink-0 items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 font-mono text-[9px] text-muted-foreground/70 hover:border-primary/40 hover:text-primary transition-colors overflow-hidden"
                          title={show.stationName}
                        >
                          <Radio className="h-2 w-2 shrink-0" />
                          <span className="truncate">{show.stationName}</span>
                        </Link>

                        {/* Show name */}
                        <Link
                          href={`/archive/stations/${show.stationSlug}?show=${encodeURIComponent(show.showName)}`}
                          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground hover:text-primary transition-colors"
                          title={show.showName}
                        >
                          {show.showName}
                        </Link>

                        {/* DJ link */}
                        {show.djName && (
                          <Link
                            href={`/dj/${encodeURIComponent(show.djName)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hidden md:inline-flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground/70 hover:text-primary transition-colors"
                            title={`${show.djName}'s schedule`}
                          >
                            <Mic className="h-2.5 w-2.5 shrink-0" />
                            <span className="max-w-[12ch] truncate">
                              {show.djName}
                            </span>
                          </Link>
                        )}
                      </div>
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
