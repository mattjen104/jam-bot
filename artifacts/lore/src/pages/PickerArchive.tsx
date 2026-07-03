import { Link, useParams } from "wouter";
import {
  useGetPickerArchive,
  useGetPickerStationOverlaps,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { FollowButton } from "../components/FollowButton";
import { ShareButton } from "../components/ShareButton";
import { runDate } from "../lib/format";
import {
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  Radio,
  Users,
} from "lucide-react";

/** A picker's documented runs — dated, ordered tracklists with sources. */
export default function PickerArchive() {
  const params = useParams();
  const handle = params.handle ?? "";
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetPickerArchive(handle);
  const { data: overlaps } = useGetPickerStationOverlaps(handle);

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
            Couldn't load this picker's archive.
          </p>
        ) : (
          <>
            <header className="mb-8 mt-6">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                <Users className="h-4 w-4" />
                Picker archive
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-3xl font-semibold text-foreground">
                  {data.picker.name}
                </h1>
                <FollowButton
                  kind="picker"
                  id={data.picker.handle}
                  name={data.picker.name}
                />
                <ShareButton
                  sharePath={`pickers/${data.picker.handle}`}
                  kind="picker"
                />
              </div>
              <p className="mt-2 max-w-[52ch] text-sm text-muted-foreground">
                {data.picker.description ?? ""}
              </p>
              {data.picker.homeUrl ? (
                <a
                  href={data.picker.homeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Source
                </a>
              ) : null}
            </header>

            {data.runs.length === 0 ? (
              <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-xs text-muted-foreground">
                No documented runs yet — syncing happens in the background.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="picker-runs">
                {data.runs.map((r) => (
                  <li key={r.runId}>
                    <Link
                      href={`/archive/picker-runs/${r.runId}`}
                      className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                      data-testid={`picker-run-${r.runId}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-serif text-base font-semibold text-foreground">
                          {r.title ?? "Untitled run"}
                        </p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {r.pickedAt ? `${runDate(r.pickedAt)} · ` : ""}
                          {r.trackCount} track{r.trackCount === 1 ? "" : "s"} ·{" "}
                          <span
                            className={
                              r.resolvedCount > 0 ? "text-primary" : ""
                            }
                          >
                            {r.resolvedCount}/{r.trackCount} resolved
                          </span>
                        </p>
                      </div>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {overlaps && overlaps.items.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-1 flex items-center gap-2 font-serif text-xl font-semibold text-foreground">
                  <Radio className="h-5 w-5 text-primary" />
                  On the radio too
                </h2>
                <p className="mb-3 text-sm text-muted-foreground">
                  Stations that have spun the exact recordings this picker
                  vouched for.
                </p>
                <ul
                  className="flex flex-col gap-2"
                  data-testid="picker-station-overlaps"
                >
                  {overlaps.items.map((o) => (
                    <li key={o.station.slug}>
                      <Link
                        href={`/archive/stations/${o.station.slug}`}
                        className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-3"
                        data-testid={`overlap-station-${o.station.slug}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {o.station.name}
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
