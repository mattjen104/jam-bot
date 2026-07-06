import { Link, useParams } from "wouter";
import {
  useGetStationArchive,
  useGetStationPickerOverlaps,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { FollowButton } from "../components/FollowButton";
import { ShareButton } from "../components/ShareButton";
import { runDate } from "../lib/format";
import { ArrowLeft, ArrowUpRight, Ghost, Radio, Users } from "lucide-react";

/** A station's documented runs — one per show and broadcast day. */
export default function StationArchive() {
  const params = useParams();
  const slug = params.slug ?? "";
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetStationArchive(slug);
  const { data: overlaps } = useGetStationPickerOverlaps(slug);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
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
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-3xl font-semibold text-foreground">
                  {data.station.name}
                </h1>
                <FollowButton
                  kind="station"
                  id={data.station.slug}
                  name={data.station.name}
                />
                <ShareButton
                  sharePath={`stations/${data.station.slug}`}
                  kind="station"
                />
              </div>
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
              <>
                {/* "Ride most recent" shortcut — only shown when the newest run
                    has at least one resolved track to queue. */}
                {data.runs[0] && data.runs[0].resolvedCount > 0 && (
                  <div className="mb-6">
                    <Link
                      href={`/archive/station-runs/${data.runs[0].runId}?play=1`}
                      data-testid="ride-most-recent"
                      className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-primary-foreground"
                    >
                      <Ghost className="h-4 w-4" />
                      Ride most recent · {data.runs[0].show?.name ?? "station stream"}
                    </Link>
                  </div>
                )}

                <ul className="flex flex-col gap-2" data-testid="station-runs">
                  {data.runs.map((r) => (
                    <li key={r.runId}>
                      <div
                        className="flex items-center gap-3 rounded-xl border border-card-border bg-card p-4"
                        data-testid={`station-run-${r.runId}`}
                      >
                        <Link
                          href={`/archive/station-runs/${r.runId}`}
                          className="min-w-0 flex-1"
                        >
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
                        </Link>
                        {r.resolvedCount > 0 ? (
                          <Link
                            href={`/archive/station-runs/${r.runId}?play=1`}
                            data-testid={`ride-run-${r.runId}`}
                            className="hover-elevate shrink-0 inline-flex items-center gap-1.5 rounded-full border border-primary-border bg-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-primary-foreground"
                          >
                            <Ghost className="h-3.5 w-3.5" />
                            Ride
                          </Link>
                        ) : (
                          <Link
                            href={`/archive/station-runs/${r.runId}`}
                            className="shrink-0 text-muted-foreground"
                          >
                            <ArrowUpRight className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {overlaps && overlaps.items.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-1 flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
                  <Users className="h-5 w-5 text-primary" />
                  Critics agree
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Selectors who vouched for the exact recordings this station has
                  spun.
                </p>
                <ul
                  className="flex flex-col gap-2"
                  data-testid="station-selector-overlaps"
                >
                  {overlaps.items.map((o) => (
                    <li key={o.picker.handle}>
                      <Link
                        href={`/archive/selectors/${o.picker.handle}`}
                        className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-3"
                        data-testid={`overlap-selector-${o.picker.handle}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {o.picker.name}
                            <span className="ml-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                              {o.picker.pickerType}
                            </span>
                          </p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">
                            {o.sharedCount} shared song
                            {o.sharedCount === 1 ? "" : "s"}
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
