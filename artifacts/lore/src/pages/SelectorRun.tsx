import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearch } from "wouter";
import { useGetPickerRun } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { ArchiveTracklist } from "../components/ArchiveTracklist";
import { ShareButton } from "../components/ShareButton";
import { runDate } from "../lib/format";
import { ArrowLeft, ExternalLink, Ghost, X } from "lucide-react";

/** One archived selector run — its picks in documented order. */
export default function SelectorRun() {
  const params = useParams();
  const search = useSearch();
  const runId = Number(params.runId ?? "");
  const searchParams = new URLSearchParams(search);
  const autoPlay = searchParams.get("play") === "1";
  const fromMbid = searchParams.get("from");
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetPickerRun(runId);
  const didAutoPlay = useRef(false);
  const [showFallbackNotice, setShowFallbackNotice] = useState(false);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  // Auto-start replay when ?play=1 is present and tracks are ready.
  // ?from=<mbid> starts mid-run at that pick ("hear it in context").
  useEffect(() => {
    if (!autoPlay || !data || didAutoPlay.current) return;
    const resolved = data.tracks.filter((t) => t.recording != null);
    if (resolved.length === 0) return;
    didAutoPlay.current = true;
    const foundIndex = fromMbid
      ? resolved.findIndex((t) => t.recording!.mbid === fromMbid)
      : -1;
    const startIndex = fromMbid ? Math.max(0, foundIndex) : 0;
    if (fromMbid && foundIndex === -1) setShowFallbackNotice(true);
    ride.startReplay(
      resolved.map((t) => ({
        mbid: t.recording!.mbid,
        title: t.recording!.title,
        artist: t.recording!.artist,
        artworkUrl: t.recording!.artworkUrl ?? null,
        links: t.recording!.links ?? [],
      })),
      `${data.picker.name}${data.run.pickedAt ? ` · ${runDate(data.run.pickedAt)}` : ""}`,
      { timeOrientation: "curated", startIndex },
    );
  }, [autoPlay, fromMbid, data, ride]);

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href={data ? `/archive/selectors/${data.picker.handle}` : "/selectors"}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {data ? `${data.picker.name} archive` : "All selectors"}
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
                  {data.run.title ?? "Untitled run"}
                </h1>
                <ShareButton
                  sharePath={`picker-runs/${runId}`}
                  kind="picker-run"
                />
              </div>
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

            {showFallbackNotice && (
              <div
                data-testid="from-fallback-notice"
                className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/60 px-4 py-3 text-sm text-muted-foreground"
              >
                <span>
                  That song isn't in this run's resolved tracklist — starting
                  from the top.
                </span>
                <button
                  aria-label="Dismiss"
                  onClick={() => setShowFallbackNotice(false)}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <ArchiveTracklist
              tracks={data.tracks}
              replayLabel={`${data.picker.name}${
                data.run.pickedAt ? ` · ${runDate(data.run.pickedAt)}` : ""
              }`}
              timeOrientation="curated"
              runSourceUrl={data.run.sourceUrl}
            />
          </>
        )}
      </div>
    </div>
  );
}
