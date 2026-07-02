import { Link } from "wouter";
import type { ArchiveTrack } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import type { TimeOrientation } from "../player/playbackSession";
import { CONFIDENCE_LABEL } from "../lib/format";
import { clockTime } from "../lib/format";
import { Ghost, Play } from "lucide-react";

/**
 * The ordered tracklist of one documented run, with a single "replay" action.
 * Unresolved tracks stay visible as honest gaps — they are listed but skipped
 * during playback, never papered over.
 *
 * `timeOrientation` distinguishes the session shape:
 * - 'past'    : ghost-radio station run (as it aired)
 * - 'curated' : picker run (ordered list from a human taste source)
 */
export function ArchiveTracklist({
  tracks,
  replayLabel,
  timeOrientation = "past",
}: {
  tracks: ArchiveTrack[];
  replayLabel: string;
  timeOrientation?: TimeOrientation;
}) {
  const { ride } = usePlayer();

  const resolved = tracks.filter((t) => t.recording != null);
  const gapCount = tracks.length - resolved.length;

  const replay = () => {
    ride.startReplay(
      resolved.map((t) => ({
        mbid: t.recording!.mbid,
        title: t.recording!.title,
        artist: t.recording!.artist,
        artworkUrl: t.recording!.artworkUrl ?? null,
        links: t.recording!.links ?? [],
      })),
      replayLabel,
      { timeOrientation },
    );
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={replay}
          disabled={resolved.length === 0}
          data-testid="replay-run"
          className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-5 py-2.5 font-mono text-xs uppercase tracking-wide text-primary-foreground disabled:opacity-40"
        >
          <Ghost className="h-4 w-4" />
          Replay this run
        </button>
        <p className="font-mono text-[11px] text-muted-foreground">
          {resolved.length} of {tracks.length} tracks resolved
          {gapCount > 0 ? ` · ${gapCount} honest gap${gapCount === 1 ? "" : "s"}` : ""}
        </p>
      </div>

      <ol className="flex flex-col gap-1.5" data-testid="archive-tracklist">
        {tracks.map((t) => {
          const rec = t.recording;
          return (
            <li
              key={`${t.position}-${t.rawTitle}`}
              className={`flex items-center gap-3 rounded-xl border p-3 ${
                rec
                  ? "border-card-border bg-card"
                  : "border-dashed border-border bg-transparent opacity-70"
              }`}
            >
              <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {t.position + 1}
              </span>
              {rec?.artworkUrl ? (
                <img
                  src={rec.artworkUrl}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  {rec ? (
                    <Play className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <Ghost className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              )}
              <div className="min-w-0 flex-1">
                {rec ? (
                  <Link
                    href={`/song/${rec.mbid}`}
                    className="block truncate font-serif text-sm font-semibold text-foreground hover:text-primary"
                  >
                    {rec.title}
                  </Link>
                ) : (
                  <p className="truncate font-serif text-sm font-semibold text-muted-foreground">
                    {t.rawTitle || "Untitled"}
                  </p>
                )}
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {rec ? rec.artist : t.rawArtist || "Unknown artist"}
                  {!rec ? " · never resolved — skipped in replay" : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {t.playedAt ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {clockTime(t.playedAt)}
                  </span>
                ) : null}
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {CONFIDENCE_LABEL[t.confidence] ?? t.confidence}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
