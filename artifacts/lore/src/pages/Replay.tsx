import { Link, useParams } from "wouter";
import { useGetReplayManifest } from "@workspace/api-client-react";
import { ArrowLeft, Download, Ghost } from "lucide-react";
import { ArchiveTracklist } from "../components/ArchiveTracklist";
import { ShareButton } from "../components/ShareButton";
import { usePlayer } from "../player/PlayerProvider";
import { runDate } from "../lib/format";
import { GuidedReplayPanel } from "../components/GuidedReplayPanel";

/** The canonical, shareable Ghost Replay reconstruction surface. */
export default function Replay() {
  const params = useParams();
  const id = Number(params.id ?? "");
  const { ride, radio } = usePlayer();
  const { data, isLoading, isError } = useGetReplayManifest(id, {
    request: { headers: { accept: "application/json" } },
  });
  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
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
          <p
            data-testid="replay-not-found"
            className="mt-8 rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground"
          >
            This replay isn't in the archive.
          </p>
        ) : (
          <>
            <header className="mb-8 mt-6">
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
                <Ghost className="h-4 w-4" />
                Ghost Replay · dated reconstruction
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <h1 className="font-serif text-3xl font-semibold text-foreground">
                  {data.show?.name ?? "Station stream"}
                  <span className="text-muted-foreground">
                    {" · "}
                    {runDate(data.bounds.date)}
                  </span>
                </h1>
                <ShareButton sharePath={`replays/${data.replayId}`} kind="replay" />
              </div>
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {data.station.name}
                {data.show?.djName ? ` · hosted by ${data.show.djName}` : ""}
                {data.picker ? ` · selected by ${data.picker.name}` : ""}
                {" · rebuilt from the station's public broadcast archive"}
              </p>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                This is a reconstruction of what aired, not a copied playlist.
                Lore preserves the broadcast order and leaves unidentified
                moments visible instead of filling them with near-matches.
              </p>
            </header>

            <section
              aria-label="Replay coverage"
              className="mb-6 grid grid-cols-3 gap-2 rounded-xl border border-card-border bg-card p-4"
              data-testid="replay-coverage"
            >
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Broadcast
                </p>
                <p className="mt-1 font-serif text-xl text-foreground">
                  {data.coverage.total}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Identified
                </p>
                <p className="mt-1 font-serif text-xl text-primary">
                  {data.coverage.resolved}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Unresolved
                </p>
                <p className="mt-1 font-serif text-xl text-muted-foreground">
                  {data.coverage.unresolved}
                </p>
              </div>
            </section>

            <section
              aria-label="Replay exports"
              className="mb-6 rounded-xl border border-card-border bg-card p-4"
              data-testid="replay-exports"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Take the reconstruction with you
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ordered broadcast receipt · {data.coverage.resolved} of{" "}
                    {data.coverage.total} identified · {data.coverage.unresolved}{" "}
                    honest gap{data.coverage.unresolved === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["jspf", "xspf", "m3u8", "csv"] as const).map((format) => (
                    <a
                      key={format}
                      href={`/api/replay/${data.replayId}/export?format=${format}`}
                      download
                      className="inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-foreground hover:border-primary hover:text-primary"
                      data-testid={`replay-export-${format}`}
                    >
                      <Download className="h-3 w-3" />
                      {format}
                    </a>
                  ))}
                </div>
              </div>
            </section>

            <ArchiveTracklist
              tracks={data.entries.map((entry) => ({
                position: entry.position,
                playedAt: entry.playedAt,
                rawArtist: entry.rawArtist,
                rawTitle: entry.rawTitle,
                confidence: entry.confidence,
                recording: entry.recording,
                spinId: entry.spinId,
              }))}
              replayLabel={`${data.station.name} · ${
                data.show?.name ?? "stream"
              } · ${runDate(data.bounds.date)}`}
              provenance={{
                kind: "keep",
                stationSlug: data.station.slug,
                stationName: data.station.name,
                pickerHandle: data.picker?.handle,
                pickerName: data.picker?.name,
              }}
              timeOrientation="past"
            />
          </>
        )}
      </div>
    </div>
  );
}
            <section
              aria-label="Replay exports"
              className="mb-6 rounded-xl border border-card-border bg-card p-4"
              data-testid="replay-exports"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Take the reconstruction with you
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Ordered broadcast receipt · {data.coverage.resolved} of{" "}
                    {data.coverage.total} identified · {data.coverage.unresolved}{" "}
                    honest gap{data.coverage.unresolved === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["jspf", "xspf", "m3u8", "csv"] as const).map((format) => (
                    <a
                      key={format}
                      href={`/api/replay/${data.replayId}/export?format=${format}`}
                      download
                      className="inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-foreground hover:border-primary hover:text-primary"
                      data-testid={`replay-export-${format}`}
                    >
                      <Download className="h-3 w-3" />
                      {format}
                    </a>
                  ))}
                </div>
              </div>
            </section>

            <ArchiveTracklist
              tracks={data.entries.map((entry) => ({
                position: entry.position,
                playedAt: entry.playedAt,
                rawArtist: entry.rawArtist,
                rawTitle: entry.rawTitle,
                confidence: entry.confidence,
                recording: entry.recording,
                spinId: entry.spinId,
              }))}
              replayLabel={`${data.station.name} · ${
                data.show?.name ?? "stream"
              } · ${runDate(data.bounds.date)}`}
              provenance={{
                kind: "keep",
                stationSlug: data.station.slug,
                stationName: data.station.name,
                pickerHandle: data.picker?.handle,
                pickerName: data.picker?.name,
              }}
              timeOrientation="past"
            />
          </>
        )}
      </div>
    </div>
  );
}
