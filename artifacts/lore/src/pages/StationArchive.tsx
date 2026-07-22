import { useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import {
  useGetStationArchive,
  useGetStationPickerOverlaps,
  useGetStationInsights,
  useGetStationUpcomingSchedule,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { FollowButton } from "../components/FollowButton";
import { ShareButton } from "../components/ShareButton";
import { StationScrubTimeline } from "../components/StationScrubTimeline";
import { GenreDiscoveryPanel } from "../components/GenreDiscoveryPanel";
import { WeeklyScheduleGrid } from "../components/WeeklyScheduleGrid";
import { runDate } from "../lib/format";
import { ArrowLeft, ArrowUpRight, CalendarDays, Ghost, Radio, Users } from "lucide-react";

type Tab = "archive" | "schedule";

/** A station's documented runs — one per show and broadcast day. */
export default function StationArchive() {
  const params = useParams();
  const slug = params.slug ?? "";
  const search = useSearch();
  const showFilter = new URLSearchParams(search).get("show") ?? null;
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetStationArchive(slug);
  const { data: overlaps } = useGetStationPickerOverlaps(slug);
  const { data: insights, isLoading: insightsLoading } = useGetStationInsights(slug);
  const { data: scheduleData, isLoading: scheduleLoading } = useGetStationUpcomingSchedule(slug);

  const [activeTab, setActiveTab] = useState<Tab>("archive");

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
            <header className="mb-6 mt-6">
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

            {/* Tab switcher */}
            <div className="mb-6 flex gap-1 rounded-xl border border-card-border bg-card p-1">
              <button
                onClick={() => setActiveTab("archive")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                  activeTab === "archive"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Ghost className="h-3.5 w-3.5" />
                Archive
              </button>
              <button
                onClick={() => setActiveTab("schedule")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                  activeTab === "schedule"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                Schedule
                {(data.station.upcomingShowCount ?? 0) > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] leading-none ${
                      activeTab === "schedule"
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {data.station.upcomingShowCount}
                  </span>
                )}
              </button>
            </div>

            {activeTab === "archive" ? (
              <>
                <div className="mb-6">
                  <GenreDiscoveryPanel
                    genreBreakdown={insights?.insights.genreBreakdown}
                    discoveryScore={insights?.insights.discoveryScore}
                    isLoading={insightsLoading}
                  />
                </div>

                <div className="mb-8">
                  <StationScrubTimeline slug={data.station.slug} stationName={data.station.name} />
                </div>

                {data.runs.length === 0 ? (
                  <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-xs text-muted-foreground">
                    Nothing documented yet — the pollers are listening.
                  </p>
                ) : (
                  <>
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

                    {showFilter && (
                      <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary-border bg-primary/10 px-4 py-2">
                        <span className="font-mono text-xs text-primary">
                          Showing runs for: <span className="font-semibold">{showFilter}</span>
                        </span>
                        <Link
                          href={`/archive/stations/${slug}`}
                          className="ml-auto font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
                        >
                          Clear filter
                        </Link>
                      </div>
                    )}

                    <ul className="flex flex-col gap-2" data-testid="station-runs">
                      {data.runs
                        .filter((r) =>
                          showFilter
                            ? (r.show?.name ?? "").toLowerCase() === showFilter.toLowerCase()
                            : true,
                        )
                        .map((r) => (
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
                                    className={r.resolvedCount > 0 ? "text-primary" : ""}
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
                      Selectors who vouched for the exact recordings this station has spun.
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
            ) : (
              /* Schedule tab */
              scheduleLoading ? (
                <div className="flex flex-col gap-3">
                  {[...Array(4)].map((_, i) => (
                    <div
                      key={i}
                      className="h-20 animate-pulse rounded-xl border border-card-border bg-card"
                    />
                  ))}
                </div>
              ) : (
                <WeeklyScheduleGrid
                  shows={scheduleData?.shows ?? []}
                  lastScrapedAt={scheduleData?.lastScrapedAt ?? null}
                />
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
