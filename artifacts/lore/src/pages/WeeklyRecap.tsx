import { Link } from "wouter";
import { ArrowLeft, Calendar, ExternalLink, Loader2, Radio } from "lucide-react";
import { useMyWeeklyRecap } from "../lib/meHooks";
import { usePlayer } from "../player/PlayerProvider";

export default function WeeklyRecap() {
  const { data, isLoading, error } = useMyWeeklyRecap();
  const { ride, radio } = usePlayer();

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-10 mt-6">
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.3em] text-primary mb-3">
            <Calendar className="h-4 w-4" />
            Weekly Recap
          </div>
          <h1 className="max-w-[20ch] font-serif text-4xl font-normal leading-[1.05] text-foreground">
            A look back at your week in radio.
          </h1>
          <p className="mt-4 max-w-[52ch] text-lg text-muted-foreground">
            A counts-only reflection of the radio you actually attended, from Sunday through Saturday.
          </p>
          {data?.week && (
            <p className="mt-3 font-mono text-[13px] uppercase tracking-wide text-muted-foreground">
              {data.week.startDate} — {data.week.endDate} · UTC
            </p>
          )}
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive-border bg-destructive/10 p-8 text-center">
            <p className="font-serif text-xl text-destructive-foreground">Failed to load weekly recap.</p>
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <p className="font-serif text-xl text-muted-foreground">Nothing to show yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-12">
            <section>
              <h2 className="mb-4 font-mono text-[13px] uppercase tracking-[0.3em] text-muted-foreground">
                Stations Attended
              </h2>
              <p className="mb-3 font-serif text-4xl text-foreground">{data.stationsAttended.count}</p>
              {data.stationsAttended.stations.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted-foreground">
                  No stations attended this week.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {data.stationsAttended.stations.map((station) => (
                    <Link
                      key={station.slug}
                      href={`/archive/stations/${station.slug}`}
                      className="rounded-full border border-card-border bg-card px-4 py-2 font-mono text-base transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      {station.name}
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-4 font-mono text-[13px] uppercase tracking-[0.3em] text-muted-foreground">
                First-Ever-Heards
              </h2>
              <p className="mb-3 font-serif text-4xl text-foreground">{data.firstEverHeards.count}</p>
              {data.firstEverHeards.items.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted-foreground">
                  No first-ever-heards this week.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.firstEverHeards.items.map((track, i) => (
                    <li
                      key={`${track.mbid}-${i}`}
                      className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4"
                    >
                      <div className="flex flex-col">
                        <Link
                          href={`/song/${track.mbid}`}
                          className="text-lg font-normal text-foreground hover:text-primary transition-colors"
                        >
                          {track.title}
                        </Link>
                        <span className="text-base" style={{ color: "hsl(var(--dim))" }}>
                          {track.artist}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Ripened Crossings */}
            <section>
              <h2 className="mb-4 font-mono text-[13px] uppercase tracking-[0.3em] text-muted-foreground">
                Ripened Crossings
              </h2>
              <p className="mb-3 font-serif text-4xl text-foreground">{data.ripenedCrossings.count}</p>
              {data.ripenedCrossings.items.length === 0 ? (
                <div className="rounded-xl border border-card-border bg-card p-6 text-center text-muted-foreground">
                  No ripened crossings this week.
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {data.ripenedCrossings.items.map((crossing, i) => (
                    <li
                      key={`${crossing.mbid}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/archive/stations/${crossing.station.slug}`}
                          className="text-lg font-normal text-foreground hover:text-primary transition-colors"
                        >
                          {crossing.title}
                        </Link>
                        <p className="text-base text-muted-foreground">
                          {crossing.artist} · {crossing.station.name}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Missed Ghost Replay */}
            {data.missedGhostReplay && (
              <section>
                <h2 className="mb-4 font-mono text-[13px] uppercase tracking-[0.3em] text-muted-foreground">
                  Missed Ghost Replay
                </h2>
                <div className="flex flex-col gap-1 rounded-xl border border-card-border bg-card p-4">
                  <Link
                    href={`/replay/${data.missedGhostReplay.replayId}`}
                    className="inline-flex items-center gap-2 text-lg font-normal text-foreground hover:text-primary transition-colors"
                  >
                    <Radio className="h-4 w-4" />
                    {data.missedGhostReplay.station.name}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                  <span className="text-base" style={{ color: "hsl(var(--dim))" }}>
                    {data.missedGhostReplay.show?.name ?? "Ghost Replay"} · {data.missedGhostReplay.date}
                  </span>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
