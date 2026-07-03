import { Link } from "wouter";
import {
  useListStations,
  useListPickers,
  useGetArchiveCoverage,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { runDate } from "../lib/format";
import { ArrowLeft, ArrowUpRight, Gauge, Ghost, Radio, Users } from "lucide-react";

/** The ghost radio hub: every archive you can replay, by picker. */
export default function Archive() {
  const { ride, radio } = usePlayer();
  const { data: stationsData, isLoading: stationsLoading } = useListStations();
  const { data: pickersData, isLoading: pickersLoading } = useListPickers();
  const { data: coverage } = useGetArchiveCoverage();

  const stations = stationsData?.stations ?? [];
  const pickers = (pickersData?.pickers ?? []).filter((p) => p.active);
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-10 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <Ghost className="h-4 w-4" />
            Ghost radio
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            Replay a run as it aired.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Every documented run — a station show's broadcast day, an NTS
            episode, a blog's tracklist — can be replayed in its original
            order. Real sequences from real people, never an algorithm.
          </p>
        </header>

        {coverage ? (
          <section
            className="mb-10 rounded-xl border border-card-border bg-card p-4"
            data-testid="archive-coverage"
          >
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              <Gauge className="h-4 w-4" />
              How deep the vault goes
            </h2>
            <ul className="flex flex-col gap-1.5">
              {coverage.stations
                .filter((s) => s.spinCount > 0)
                .map((s) => (
                  <li
                    key={s.slug}
                    className="font-mono text-[11px] text-muted-foreground"
                    data-testid={`coverage-station-${s.slug}`}
                  >
                    <span className="text-foreground">{s.name}</span>
                    {s.oldestSpinAt
                      ? ` · back to ${runDate(s.oldestSpinAt)}`
                      : ""}
                    {" · "}
                    {s.spinCount.toLocaleString()} spins ·{" "}
                    <span className="text-primary">
                      {Math.round((s.resolvedCount / s.spinCount) * 100)}%
                      resolved
                    </span>
                    {s.supportsBackfill
                      ? s.backfillDone
                        ? " · backfill complete"
                        : " · still digging back"
                      : ""}
                  </li>
                ))}
              {coverage.pickers
                .filter((p) => p.pickCount > 0)
                .map((p) => (
                  <li
                    key={p.handle}
                    className="font-mono text-[11px] text-muted-foreground"
                    data-testid={`coverage-picker-${p.handle}`}
                  >
                    <span className="text-foreground">{p.name}</span>
                    {p.oldestPickedAt
                      ? ` · back to ${runDate(p.oldestPickedAt)}`
                      : ""}
                    {" · "}
                    {p.runCount} run{p.runCount === 1 ? "" : "s"} ·{" "}
                    {p.pickCount.toLocaleString()} picks ·{" "}
                    <span className="text-primary">
                      {Math.round((p.resolvedCount / p.pickCount) * 100)}%
                      resolved
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
            <Radio className="h-4 w-4 text-primary" />
            Station archives
          </h2>
          {stationsLoading ? (
            <ListSkeleton />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="archive-stations">
              {stations.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={`/archive/stations/${s.slug}`}
                    className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                    data-testid={`archive-station-${s.slug}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-serif text-base font-semibold text-foreground">
                        {s.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {s.org} · documented runs by show and broadcast day
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
            <Users className="h-4 w-4 text-primary" />
            Picker archives
          </h2>
          {pickersLoading ? (
            <ListSkeleton />
          ) : pickers.length === 0 ? (
            <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-xs text-muted-foreground">
              No pickers with documented runs yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="archive-pickers">
              {pickers.map((p) => (
                <li key={p.handle}>
                  <Link
                    href={`/archive/pickers/${p.handle}`}
                    className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                    data-testid={`archive-picker-${p.handle}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-serif text-base font-semibold text-foreground">
                        {p.name}
                      </p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.pickerType}
                        {p.description ? ` · ${p.description}` : ""}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {[0, 1].map((i) => (
        <li
          key={i}
          className="h-16 animate-pulse rounded-xl border border-card-border bg-card"
        />
      ))}
    </ul>
  );
}
