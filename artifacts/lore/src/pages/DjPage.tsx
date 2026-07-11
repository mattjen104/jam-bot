import { Link, useParams } from "wouter";
import { useGetDjShows } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { ArrowLeft, Mic, Radio } from "lucide-react";

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function groupByStation(shows: { stationSlug: string; stationName: string; showName: string; dayOfWeek: string; startTime: string; endTime: string }[]) {
  const map = new Map<string, { stationName: string; stationSlug: string; shows: typeof shows }>();
  for (const show of shows) {
    const key = show.stationSlug;
    if (!map.has(key)) map.set(key, { stationName: show.stationName, stationSlug: show.stationSlug, shows: [] });
    map.get(key)!.shows.push(show);
  }
  return [...map.values()].sort((a, b) => a.stationName.localeCompare(b.stationName));
}

function groupByDay(shows: { showName: string; dayOfWeek: string; startTime: string; endTime: string }[]) {
  const map = new Map<string, typeof shows>();
  for (const show of shows) {
    if (!map.has(show.dayOfWeek)) map.set(show.dayOfWeek, []);
    map.get(show.dayOfWeek)!.push(show);
  }
  return DAY_ORDER
    .filter((d) => map.has(d))
    .map((d) => ({ day: d, shows: map.get(d)!.sort((a, b) => a.startTime.localeCompare(b.startTime)) }));
}

export default function DjPage() {
  const params = useParams();
  const name = decodeURIComponent(params.name ?? "");
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetDjShows(name);
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

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

        <header className="mb-8 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <Mic className="h-4 w-4" />
            DJ schedule
          </div>
          <h1 className="mt-3 font-serif text-3xl font-semibold text-foreground">
            {name}
          </h1>
        </header>

        {isLoading && (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl border border-card-border bg-card" />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
            DJ not found or no shows scraped yet.
          </div>
        )}

        {data && data.shows.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-6 text-center font-mono text-sm text-muted-foreground">
            No schedule found for this DJ yet.
          </div>
        )}

        {data && data.shows.length > 0 && (
          <div className="space-y-6">
            {groupByStation(data.shows).map(({ stationSlug, stationName, shows }) => {
              const byDay = groupByDay(shows);
              return (
                <div key={stationSlug} className="rounded-xl border border-card-border bg-card p-5">
                  <div className="mb-4 flex items-center gap-2">
                    <Radio className="h-4 w-4 shrink-0 text-primary" />
                    <Link
                      href={`/archive/stations/${stationSlug}`}
                      className="font-serif text-lg font-semibold text-foreground hover:text-primary"
                    >
                      {stationName}
                    </Link>
                  </div>
                  <div className="space-y-3">
                    {byDay.map(({ day, shows: dayShows }) => (
                      <div key={day} className="flex flex-wrap items-start gap-2">
                        <span className="w-9 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted-foreground pt-0.5">
                          {day}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {dayShows.map((show, i) => (
                            <Link
                              key={i}
                              href={`/archive/stations/${stationSlug}?show=${encodeURIComponent(show.showName)}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-3 py-1 font-mono text-[11px] text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors"
                            >
                              {show.showName}
                              <span className="text-muted-foreground/70">
                                {show.startTime}–{show.endTime}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
