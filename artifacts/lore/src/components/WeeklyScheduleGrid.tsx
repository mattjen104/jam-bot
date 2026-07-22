import { Link } from "wouter";
import type { ScrapedShow } from "@workspace/api-client-react";
import { CalendarDays, Clock, Radio } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];

const DAY_LABELS: Record<Day, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

function timeToMinutes(hhmm: string): number {
  const parts = hhmm.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  return h * 60 + m;
}

function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${mStr}${suffix}`;
}

function getCurrentContext(): { day: Day; minutesNow: number; yesterday: Day } {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun, 1=Mon…6=Sat
  const dayMap: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = dayMap[jsDay] ?? "Mon";
  const yesterday = dayMap[(jsDay + 6) % 7] ?? "Sun";
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return { day, minutesNow, yesterday };
}

function isAiring(show: ScrapedShow, day: Day, minutesNow: number, yesterday: Day): boolean {
  const start = timeToMinutes(show.startTime);
  const end = timeToMinutes(show.endTime);
  if (show.dayOfWeek === day) {
    if (end > start) {
      return minutesNow >= start && minutesNow < end;
    }
    return minutesNow >= start;
  }
  if (show.dayOfWeek === yesterday && end <= start) {
    return minutesNow < end;
  }
  return false;
}

interface WeeklyScheduleGridProps {
  shows: ScrapedShow[];
  lastScrapedAt: string | null;
}

export function WeeklyScheduleGrid({ shows, lastScrapedAt }: WeeklyScheduleGridProps) {
  if (shows.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-8 text-center">
        <Radio className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
        <p className="font-mono text-xs text-muted-foreground">
          No schedule available for this station yet.
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">
          Schedule data is collected automatically — check back soon.
        </p>
      </div>
    );
  }

  const { day: currentDay, minutesNow, yesterday } = getCurrentContext();

  const byDay = new Map<Day, ScrapedShow[]>();
  for (const d of DAYS) byDay.set(d, []);
  for (const show of shows) {
    const d = show.dayOfWeek as Day;
    if (byDay.has(d)) byDay.get(d)!.push(show);
  }

  const activeDays = DAYS.filter((d) => (byDay.get(d)?.length ?? 0) > 0);

  return (
    <div className="flex flex-col gap-4">
      {activeDays.map((day) => {
        const dayShows = byDay.get(day) ?? [];
        const isToday = day === currentDay;
        return (
          <section key={day}>
            <div
              className={`mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] ${
                isToday ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {DAY_LABELS[day]}
              {isToday && (
                <span className="ml-1 rounded-full border border-primary-border bg-primary/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-primary">
                  Today
                </span>
              )}
            </div>
            <ul className="flex flex-col gap-1.5">
              {dayShows.map((show, i) => {
                const airing = isAiring(show, currentDay, minutesNow, yesterday);
                return (
                  <li key={`${day}-${i}`}>
                    <div
                      className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                        airing
                          ? "border-primary-border bg-primary/10"
                          : "border-card-border bg-card"
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <p className="truncate text-sm font-medium text-foreground">
                          {show.showName}
                          {airing && (
                            <span className="ml-2 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-primary">
                              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                              On air
                            </span>
                          )}
                        </p>
                        {show.djName && (
                          <Link
                            href={`/dj/${encodeURIComponent(show.djName)}`}
                            className="mt-0.5 w-fit font-mono text-[11px] text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {show.djName}
                          </Link>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatTime(show.startTime)}
                        <span className="mx-0.5">–</span>
                        {formatTime(show.endTime)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {lastScrapedAt && (
        <p className="font-mono text-[10px] text-muted-foreground/50">
          Schedule last updated {new Date(lastScrapedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {" "}· Times shown in the station's own local time.
        </p>
      )}
    </div>
  );
}
