import { Link, useParams } from "wouter";
import { useGetStationRun } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { ArchiveTracklist } from "../components/ArchiveTracklist";
import { ShareButton } from "../components/ShareButton";
import { runDate } from "../lib/format";
import { ArrowLeft, ExternalLink, Ghost } from "lucide-react";

/** One archived station run — its full tracklist, exactly as it aired. */
export default function StationRun() {
  const params = useParams();
  const runId = Number(params.runId ?? "");
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetStationRun(runId);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href={data ? `/archive/stations/${data.station.slug}` : "/archive"}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {data ? `${data.station.name} archive` : "All archives"}
        </Link>

        {isLoading ? (
          <div className="mt-8 h-64 animate-pulse rounded-xl border border-card-border bg-card" />
        ) : isError || !data ? (
          <p className="mt-8 rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
            This run isn't in the archive.
          </p>
        ) : (
          <>
            <header className="mb-8 mt-6">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                <Ghost className="h-4 w-4" />
                Dated reconstruction
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-3xl font-semibold text-foreground">
                  {data.run.show?.name ?? "Station stream"}
                  <span className="text-muted-foreground"> · {runDate(data.run.date)}</span>
                </h1>
                <ShareButton
                  sharePath={`station-runs/${runId}`}
                  kind="station-run"
                />
              </div>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {data.station.name}
                {data.run.show?.djName ? ` · hosted by ${data.run.show.djName}` : ""} ·
                aired {runDate(data.run.date)} · rebuilt from the station's
                public playlist
              </p>
              {data.run.sourceUrl ? (
                <a
                  href={data.run.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-primary hover:underline"
                  data-testid="run-source-link"
                >
                  <ExternalLink className="h-3 w-3" />
                  Original source
                </a>
              ) : null}
            </header>

            <ArchiveTracklist
              tracks={data.tracks}
              replayLabel={`${data.station.name} · ${
                data.run.show?.name ?? "stream"
              } · ${runDate(data.run.date)}`}
              timeOrientation="past"
            />
          </>
        )}
      </div>
    </div>
  );
}
