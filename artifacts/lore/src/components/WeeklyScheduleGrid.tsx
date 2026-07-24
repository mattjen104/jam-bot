import { Link } from "wouter";
import type { ScrapedShow } from "@workspace/api-client-react";
import { Radio } from "lucide-react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Day = (typeof DAYS)[number];

const DAY_SHORT: Record<Day, string> = {
  Mon: "Mon",
  Tue: "Tue",
  Wed: "Wed",
  Thu: "Thu",
  Fri: "Fri",
  Sat: "Sat",
  Sun: "Sun",
};

const DAY_LONG: Record<Day, string> = {
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
  const jsDay = now.getDay(); // 0=Sun…6=Sat
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
    // Overnight: started today, ends tomorrow (endTime < startTime)
    return minutesNow >= start;
  }
  // Overnight carryover: started yesterday, still running today
  if (show.dayOfWeek === yesterday && end <= start) {
    return minutesNow < end;
  }
  return false;
}

/**
 * Convert an IANA timezone identifier to a friendly display label using the
 * browser's Intl API. Returns e.g. "Pacific Standard Time (PST)" or
 * "Central European Time (CET)". Falls back to the raw identifier on error.
 */
function friendlyTimezone(ianaZone: string): string {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaZone,
      timeZoneName: "long",
    }).formatToParts(now);
    const shortParts = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaZone,
      timeZoneName: "short",
    }).formatToParts(now);
    const long = parts.find((p) => p.type === "timeZoneName")?.value ?? null;
    const abbr = shortParts.find((p) => p.type === "timeZoneName")?.value ?? null;
    if (long && abbr && long !== abbr) return `${long} (${abbr})`;
    return long ?? abbr ?? ianaZone;
  } catch {
    return ianaZone;
  }
}

interface WeeklyScheduleGridProps {
  shows: ScrapedShow[];
  lastScrapedAt: string | null;
  timezoneHint?: string | null;
}

export function WeeklyScheduleGrid({ shows, lastScrapedAt, timezoneHint }: WeeklyScheduleGridProps) {
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

  // Build lookup: day → startTime → show
  const lookup = new Map<Day, Map<string, ScrapedShow>>();
  for (const d of DAYS) lookup.set(d, new Map());
  for (const show of shows) {
    lookup.get(show.dayOfWeek as Day)?.set(show.startTime, show);
  }

  // Collect all unique start times, sorted chronologically
  const allTimes = [...new Set(shows.map((s) => s.startTime))].sort();

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal-scroll wrapper so the 7-column grid works on small screens */}
      <div className="overflow-x-auto rounded-xl border border-card-border">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-card-border bg-card">
              {/* Empty time-label column header */}
              <th className="w-16 px-3 py-2.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
                Time
              </th>
              {DAYS.map((d) => (
                <th
                  key={d}
                  title={DAY_LONG[d]}
                  className={`px-3 py-2.5 font-mono text-[10px] uppercase tracking-wide ${
                    d === currentDay ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {DAY_SHORT[d]}
                  {d === currentDay && (
                    <span className="ml-1.5 rounded-full border border-primary-border bg-primary/10 px-1 py-0.5 text-[8px] text-primary">
                      today
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allTimes.map((time, rowIdx) => (
              <tr
                key={time}
                className={`border-b border-card-border/50 ${
                  rowIdx % 2 === 0 ? "bg-card" : "bg-card/40"
                }`}
              >
                {/* Time label */}
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                  {formatTime(time)}
                </td>

                {/* One cell per day */}
                {DAYS.map((d) => {
                  const show = lookup.get(d)?.get(time);
                  if (!show) {
                    return (
                      <td key={d} className="px-2 py-2.5">
                        <span className="text-muted-foreground/20">—</span>
                      </td>
                    );
                  }
                  const airing = isAiring(show, currentDay, minutesNow, yesterday);
                  return (
                    <td
                      key={d}
                      className={`px-2 py-2 ${airing ? "bg-primary/10" : ""}`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <span
                          className={`text-[12px] font-medium leading-snug ${
                            airing ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {show.showName}
                          {airing && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 font-mono text-[9px] uppercase tracking-wide text-primary">
                              <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-primary" />
                              live
                            </span>
                          )}
                        </span>
                        {show.djName && (
                          <Link
                            href={`/dj/${encodeURIComponent(show.djName)}`}
                            className="w-fit font-mono text-[10px] text-muted-foreground hover:text-primary"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {show.djName}
                          </Link>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground/60">
                          {formatTime(show.startTime)}–{formatTime(show.endTime)}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {lastScrapedAt && (
        <p className="font-mono text-[10px] text-muted-foreground/50">
          Schedule last updated{" "}
          {new Date(lastScrapedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          ·{" "}
          {timezoneHint
            ? `Times in ${friendlyTimezone(timezoneHint)}.`
            : "Times shown in the station's own local time."}
        </p>
      )}
    </div>
  );
}
