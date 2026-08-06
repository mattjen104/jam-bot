import { Link } from "wouter";
import { proxyArtUrl } from "../lib/proxyArt";
import type { ArchiveTrack } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import type { TimeOrientation } from "../player/playbackSession";
import { CONFIDENCE_LABEL } from "../lib/format";
import { clockTime } from "../lib/format";
import { ExternalLink, Ghost, Play } from "lucide-react";
import { KeepButton } from "./KeepButton";
import { onArtError } from "../lib/rumours";

const BANDCAMP_HOST_RE = /bandcamp\.com/i;

/**
 * The ordered tracklist of one documented run, with a single "replay" action.
 * Unresolved tracks stay visible as honest gaps — they are listed but skipped
 * during playback, never papered over.
 *
 * `timeOrientation` distinguishes the session shape:
 * - 'past'    : ghost-radio station run (as it aired)
 * - 'curated' : picker run (ordered list from a human taste source)
 *
 * `runSourceUrl` is the source article/page URL for the whole run. When it
 * points to Bandcamp, unresolved tracks show a "Listen on Bandcamp →" link so
 * the listener can still reach the audio even if the track wasn't resolved to
 * the spine.
 */
export function ArchiveTracklist({
  tracks,
  replayLabel,
  timeOrientation = "past",
  runSourceUrl,
  provenance,
}: {
  tracks: Array<ArchiveTrack & { spinId?: number }>;
  replayLabel: string;
  timeOrientation?: TimeOrientation;
  runSourceUrl?: string | null;
  provenance?: Parameters<typeof KeepButton>[0]["provenance"];
}) {
  const { ride } = usePlayer();

  const resolved = tracks.filter((t) => t.recording != null);
  const gapCount = tracks.length - resolved.length;
  const isBandcampRun = runSourceUrl ? BANDCAMP_HOST_RE.test(runSourceUrl) : false;

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
          className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-40"
        >
          <Ghost className="h-4 w-4" />
          Replay this run
        </button>
        <p className="font-mono text-[13px] text-muted-foreground">
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
              <span className="w-7 shrink-0 text-right font-mono text-[13px] text-muted-foreground">
                {t.position + 1}
              </span>
              {rec?.artworkUrl ? (
                <img
                  src={proxyArtUrl(rec.artworkUrl)!}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md object-cover"
                  loading="lazy"
                  onError={onArtError}
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
                    className="block truncate font-serif text-base font-normal text-foreground hover:text-primary"
                  >
                    {rec.title}
                  </Link>
                ) : (
                  <p className="truncate font-serif text-base font-normal text-muted-foreground">
                    {t.rawTitle || "Untitled"}
                  </p>
                )}
                <p className="truncate font-mono text-[13px] text-muted-foreground">
                  {rec ? (
                    rec.artistMbid ? (
                      <Link
                        href={`/artist/${rec.artistMbid}`}
                        className="hover:text-primary hover:underline"
                      >
                        {rec.artist}
                      </Link>
                    ) : (
                      rec.artist
                    )
                  ) : (
                    t.rawArtist || "Unknown artist"
                  )}
                  {!rec && !isBandcampRun ? " · never resolved — skipped in replay" : ""}
                  {!rec && isBandcampRun ? " · unresolved — skipped in replay" : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {rec?.links?.some((link) => link.kind === "exact") ? (
                  <div className="flex flex-wrap justify-end gap-1">
                    {rec.links
                      .filter((link) => link.kind === "exact")
                      .slice(0, 2)
                      .map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[12px] uppercase tracking-wide text-primary hover:underline"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          {link.name}
                        </a>
                      ))}
                  </div>
                ) : null}
                {!rec && isBandcampRun && runSourceUrl ? (
                  <a
                    href={runSourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[12px] uppercase tracking-wide text-primary hover:underline"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Listen on Bandcamp
                  </a>
                ) : t.playedAt ? (
                  <span className="font-mono text-[13px] text-muted-foreground">
                    {clockTime(t.playedAt)}
                  </span>
                ) : null}
                <span className="font-mono text-[12px] uppercase tracking-wide text-muted-foreground/70">
                  {CONFIDENCE_LABEL[t.confidence] ?? t.confidence}
                </span>
                {t.spinId != null ? (
                  <KeepButton
                    mbid={rec?.mbid ?? null}
                    spinId={t.spinId}
                    provenance={provenance}
                    compact
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
