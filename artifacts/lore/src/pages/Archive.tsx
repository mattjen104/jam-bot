import { useState } from "react";
import { Link } from "wouter";
import {
  useListStations,
  useListPickers,
  useGetArchiveCoverage,
  useGetArchiveRecentRuns,
  useSearchArtistRuns,
  getSearchArtistRunsQueryKey,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { runDate } from "../lib/format";
import {
  ArrowLeft,
  ArrowUpRight,
  Gauge,
  Ghost,
  Radio,
  Search,
  Users,
} from "lucide-react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

/** The ghost radio hub: every archive you can replay, by picker. */
export default function Archive() {
  const { ride, radio } = usePlayer();
  const { data: stationsData, isLoading: stationsLoading } = useListStations();
  const { data: pickersData, isLoading: pickersLoading } = useListPickers();
  const { data: coverage } = useGetArchiveCoverage();
  const {
    data: recentRunsData,
    isLoading: recentRunsLoading,
  } = useGetArchiveRecentRuns();
  const [artistQuery, setArtistQuery] = useState("");
  const debouncedQuery = useDebouncedValue(artistQuery.trim(), 350);
  const searchEnabled = debouncedQuery.length >= 2;
  const { data: artistRuns, isFetching: searchFetching } = useSearchArtistRuns(
    { q: debouncedQuery },
    {
      query: {
        queryKey: getSearchArtistRunsQueryKey({ q: debouncedQuery }),
        enabled: searchEnabled,
      },
    },
  );

  const stations = stationsData?.stations ?? [];
  const pickers = (pickersData?.pickers ?? []).filter((p) => p.active);
  const recentRuns = recentRunsData?.items ?? [];
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[13px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-10 mt-6">
          <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.3em] text-primary">
            <Ghost className="h-4 w-4" />
            Ghost radio
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-normal leading-[1.05] text-foreground">
            Replay a run as it aired.
          </h1>
          <p className="mt-4 max-w-[52ch] text-lg text-muted-foreground">
            Every documented run — a station show's broadcast day, an NTS
            episode, a blog's tracklist — can be replayed in its original
            order. Real sequences from real people, never an algorithm.
          </p>
        </header>

        <section className="mb-10">
          <label
            htmlFor="artist-run-search"
            className="mb-3 flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.3em] text-primary"
          >
            <Search className="h-4 w-4" />
            Who played my artist?
          </label>
          <input
            id="artist-run-search"
            type="search"
            value={artistQuery}
            onChange={(e) => setArtistQuery(e.target.value)}
            placeholder="Type an artist — e.g. Fleetwood Mac"
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 font-mono text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="input-artist-run-search"
          />
          {searchEnabled ? (
            <div className="mt-4" data-testid="artist-run-results">
              {searchFetching && !artistRuns ? (
                <p className="font-mono text-sm text-muted-foreground">
                  Digging through the vault…
                </p>
              ) : artistRuns &&
                artistRuns.stationRuns.length === 0 &&
                artistRuns.pickerRuns.length === 0 ? (
                <p
                  className="rounded-xl border border-card-border bg-card p-4 font-mono text-sm text-muted-foreground"
                  data-testid="artist-run-empty"
                >
                  No documented runs with “{debouncedQuery}” yet.
                </p>
              ) : artistRuns ? (
                <ul className="flex flex-col gap-2">
                  {artistRuns.stationRuns.map((m) => (
                    <li key={`s-${m.run.runId}`}>
                      <Link
                        href={`/archive/station-runs/${m.run.runId}`}
                        className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                        data-testid={`artist-run-station-${m.run.runId}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-serif text-lg font-normal text-foreground">
                            {m.station.name}
                            {m.run.show ? ` · ${m.run.show.name}` : ""}
                          </p>
                          <p className="truncate font-mono text-[13px] text-muted-foreground">
                            {runDate(m.run.startedAt)} · {m.matchCount} track
                            {m.matchCount === 1 ? "" : "s"} matched ·{" "}
                            {m.run.spinCount} spins in the run
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                  {artistRuns.pickerRuns.map((m) => (
                    <li key={`p-${m.runId}`}>
                      <Link
                        href={`/archive/selector-runs/${m.runId}`}
                        className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                        data-testid={`artist-run-picker-${m.runId}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-serif text-lg font-normal text-foreground">
                            {m.picker.name}
                            {m.title ? ` · ${m.title}` : ""}
                          </p>
                          <p className="truncate font-mono text-[13px] text-muted-foreground">
                            {m.pickedAt ? `${runDate(m.pickedAt)} · ` : ""}
                            {m.matchCount} track
                            {m.matchCount === 1 ? "" : "s"} matched ·{" "}
                            {m.trackCount} in the list
                          </p>
                        </div>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {coverage ? (
          <section
            className="mb-10 rounded-xl border border-card-border bg-card p-4"
            data-testid="archive-coverage"
          >
            <h2 className="mb-3 flex items-center gap-2 font-mono text-[13px] uppercase tracking-[0.3em] text-primary">
              <Gauge className="h-4 w-4" />
              How deep the vault goes
            </h2>
            <ul className="flex flex-col gap-1.5">
              {coverage.stations
                .filter((s) => s.spinCount > 0)
                .map((s) => (
                  <li
                    key={s.slug}
                    className="font-mono text-[13px] text-muted-foreground"
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
                    className="font-mono text-[13px] text-muted-foreground"
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
          <h2 className="mb-4 flex items-center gap-2 font-serif text-2xl font-normal text-foreground">
            <Ghost className="h-4 w-4 text-primary" />
            Recent runs
          </h2>
          {recentRunsLoading ? (
            <ListSkeleton />
          ) : recentRuns.length === 0 ? (
            <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-sm text-muted-foreground">
              No documented runs yet.
            </p>
          ) : (
            <>
              <ul className="flex flex-col gap-2" data-testid="archive-recent-runs">
                {recentRuns.map((item) => (
                  <li key={`${item.station.slug}-${item.run.runId}`}>
                    <Link
                      href={`/archive/station-runs/${item.run.runId}`}
                      className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                      data-testid={`recent-run-${item.run.runId}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-serif text-lg font-normal text-foreground">
                          {item.station.name}
                          {item.run.show ? ` · ${item.run.show.name}` : ""}
                        </p>
                        <p className="truncate font-mono text-[13px] text-muted-foreground">
                          {runDate(item.run.startedAt)} · {item.run.spinCount}{" "}
                          track{item.run.spinCount === 1 ? "" : "s"} ·{" "}
                          <span
                            className={
                              item.run.resolvedCount > 0 ? "text-primary" : ""
                            }
                          >
                            {item.run.resolvedCount}/{item.run.spinCount} resolved
                          </span>
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 flex items-center gap-2 font-serif text-2xl font-normal text-foreground">
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
                      <p className="truncate font-serif text-lg font-normal text-foreground">
                        {s.name}
                      </p>
                      <p className="truncate font-mono text-[13px] text-muted-foreground">
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
          <h2 className="mb-4 flex items-center gap-2 font-serif text-2xl font-normal text-foreground">
            <Users className="h-4 w-4 text-primary" />
            Selector archives
          </h2>
          {pickersLoading ? (
            <ListSkeleton />
          ) : pickers.length === 0 ? (
            <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-sm text-muted-foreground">
              No selectors with documented runs yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="archive-selectors">
              {pickers.map((p) => (
                <li key={p.handle}>
                  <Link
                    href={`/archive/selectors/${p.handle}`}
                    className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                    data-testid={`archive-selector-${p.handle}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-serif text-lg font-normal text-foreground">
                        {p.name}
                      </p>
                      <p className="truncate font-mono text-[13px] text-muted-foreground">
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
