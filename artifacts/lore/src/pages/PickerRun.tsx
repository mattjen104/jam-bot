import { Link, useParams } from "wouter";
import { useGetPickerRun } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { ArchiveTracklist } from "../components/ArchiveTracklist";
import { runDate } from "../lib/format";
import { ArrowLeft, ExternalLink, Ghost } from "lucide-react";

/** One archived picker run — its picks in documented order. */
export default function PickerRun() {
  const params = useParams();
  const runId = Number(params.runId ?? "");
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetPickerRun(runId);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className={`relative z-10 mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href={data ? `/archive/pickers/${data.picker.handle}` : "/archive"}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {data ? `${data.picker.name} archive` : "All archives"}
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
              <h1 className="mt-3 font-serif text-3xl font-semibold text-foreground">
                {data.run.title ?? "Untitled run"}
              </h1>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                Picked by {data.picker.name}
                {data.run.pickedAt ? ` · ${runDate(data.run.pickedAt)}` : ""}
              </p>
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
            </header>

            <ArchiveTracklist
              tracks={data.tracks}
              replayLabel={`${data.picker.name}${
                data.run.pickedAt ? ` · ${runDate(data.run.pickedAt)}` : ""
              }`}
            />
          </>
        )}
      </div>
    </div>
  );
}
