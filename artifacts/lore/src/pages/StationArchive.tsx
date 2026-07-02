import { Link, useParams } from "wouter";
import { useGetStationArchive } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { runDate } from "../lib/format";
import { ArrowLeft, ArrowUpRight, Radio } from "lucide-react";

/** A station's documented runs — one per show and broadcast day. */
export default function StationArchive() {
  const params = useParams();
  const slug = params.slug ?? "";
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetStationArchive(slug);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/archive"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All archives
        </Link>

        {isLoading ? (
          <div className="mt-8 h-40 animate-pulse rounded-xl border border-card-border bg-card" />
        ) : isError || !data ? (
          <p className="mt-8 rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
            Couldn't load this station's archive.
          </p>
        ) : (
          <>
            <header className="mb-8 mt-6">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                <Radio className="h-4 w-4" />
                Station archive
              </div>
              <h1 className="mt-3 font-serif text-3xl font-semibold text-foreground">
                {data.station.name}
              </h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {data.runs.length} documented run{data.runs.length === 1 ? "" : "s"} ·
                grouped by show and broadcast day (UTC)
              </p>
            </header>

            {data.runs.length === 0 ? (
              <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-xs text-muted-foreground">
                Nothing documented yet — the pollers are listening.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="station-runs">
                {data.runs.map((r) => (
                  <li key={r.runId}>
                    <Link
                      href={`/archive/station-runs/${r.runId}`}
                      className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                      data-testid={`station-run-${r.runId}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-serif text-base font-semibold text-foreground">
                          {r.show?.name ?? "Station stream"}
                          {r.show?.djName ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · {r.show.djName}
                            </span>
                          ) : null}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {runDate(r.date)} · {r.spinCount} track
                          {r.spinCount === 1 ? "" : "s"} ·{" "}
                          <span
                            className={
                              r.resolvedCount > 0 ? "text-primary" : ""
                            }
                          >
                            {r.resolvedCount}/{r.spinCount} resolved
                          </span>
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
