import { Download, FileDown } from "lucide-react";
import type { ReplayManifest } from "@workspace/api-client-react";
import { ReplayPlaylistPanel } from "./ReplayPlaylistPanel";

type Coverage = ReplayManifest["coverage"];
type ReplayEntry = ReplayManifest["entries"][number];

const SECONDARY_FORMATS = [
  {
    format: "jspf" as const,
    note: "JSON interchange for playlist conversion tools",
  },
  {
    format: "m3u8" as const,
    note: "Plain track list read by many players",
  },
  {
    format: "csv" as const,
    note: "Full spreadsheet receipt of the broadcast",
  },
];

/**
 * One ordered export surface for a Ghost Replay, replacing the previous
 * parallel panels. The cascade runs strongest route first:
 *
 *   1. Connected services — direct, one-click playlist creation. When Lore can
 *      materialize a playlist on a service directly, no file or converter
 *      route is suggested for that service.
 *   2. Default media player — a downloadable XSPF standards playlist the
 *      listener opens from their downloads folder. Lore cannot launch or
 *      control a native player from the browser, and the copy says so:
 *      matching against owned files is the player's job, best-effort.
 *   3. Other portable formats — JSPF/M3U8/CSV for conversion and receipts,
 *      kept available without claiming native-player guarantees.
 *
 * Coverage is shown as factual counts plus the names of unresolved entries —
 * never percentages, scores, or fabricated matches.
 */
export function ReplayExportCascade({
  replayId,
  coverage,
  entries,
}: {
  replayId: number;
  coverage: Coverage;
  entries: ReplayEntry[];
}) {
  const unresolved = entries.filter((entry) => !entry.recording);

  return (
    <section
      aria-label="Take this replay with you"
      className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-4"
      data-testid="replay-export-cascade"
    >
      <p className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
        Take the reconstruction with you
      </p>
      <p className="mt-1 text-base text-muted-foreground" data-testid="cascade-coverage">
        {coverage.resolved} of {coverage.total} broadcast entries identified ·{" "}
        {coverage.unresolved} honest gap{coverage.unresolved === 1 ? "" : "s"}.
        Every route below carries exactly these entries — gaps are named, never
        filled with near-matches.
      </p>
      {unresolved.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="cascade-gaps">
          {unresolved.map((entry) => (
            <span
              key={entry.spinId}
              className="rounded-full border border-border px-2 py-0.5 font-mono text-[12px] text-muted-foreground"
            >
              {entry.rawArtist} — {entry.rawTitle}
            </span>
          ))}
        </div>
      ) : null}

      {/* Tier 1 — connected services: the direct, primary route. */}
      <div
        className="mt-4 rounded-lg border border-primary/30 bg-background/60 p-3"
        data-testid="cascade-tier-services"
      >
        <ReplayPlaylistPanel replayId={replayId} embedded />
      </div>

      {/* Tier 2 — universal handoff to the listener's default media player. */}
      <div
        className="mt-3 rounded-lg border border-border bg-background/40 p-3"
        data-testid="cascade-tier-player"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-lg font-normal text-foreground">
              Open in your default media player
            </h3>
            <p className="mt-1 max-w-xl text-base leading-relaxed text-muted-foreground">
              Download this replay as an XSPF standards playlist, then open the
              downloaded file from your downloads folder — your operating
              system hands it to its associated media player. The player may
              match entries against music you already own; how much it finds
              depends on that player and your files, and Lore cannot launch or
              control it from the browser.
            </p>
          </div>
          <a
            href={`/api/replay/${replayId}/export?format=xspf`}
            download
            className="hover-elevate inline-flex shrink-0 items-center gap-2 rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-[13px] uppercase tracking-wide text-primary-foreground"
            data-testid="replay-export-xspf"
          >
            <FileDown className="h-3.5 w-3.5" />
            Download XSPF playlist
          </a>
        </div>
      </div>

      {/* Tier 3 — other portable formats for conversion and record-keeping. */}
      <div
        className="mt-3 rounded-lg border border-border bg-background/40 p-3"
        data-testid="cascade-tier-formats"
      >
        <h3 className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
          Other portable formats
        </h3>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {SECONDARY_FORMATS.map(({ format, note }) => (
            <a
              key={format}
              href={`/api/replay/${replayId}/export?format=${format}`}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-2 font-mono text-[12px] uppercase tracking-wide text-foreground hover:border-primary hover:text-primary"
              data-testid={`replay-export-${format}`}
            >
              <Download className="h-3 w-3" />
              {format}
              <span className="normal-case tracking-normal text-muted-foreground">
                · {note}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
