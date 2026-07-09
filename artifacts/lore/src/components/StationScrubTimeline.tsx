import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetStationSpins } from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { CONFIDENCE_LABEL, clockTime, runDate } from "../lib/format";
import { Ghost, History, Play } from "lucide-react";

const SLIDER_MAX = 1000;
const PAGE_SIZE = 25;
const SCRUB_DEBOUNCE_MS = 250;

/**
 * A continuous, time-based scrub control over a station's *entire* logged
 * spin history — independent of the show/run grouping in StationArchive.
 * Works identically for a flagship curated station and a longtail
 * radio-browser/ICY station with only raw titles: it never depends on show
 * metadata, only on the permanent spin log.
 *
 * Loads progressively: dragging the slider computes a `before` timestamp and
 * fetches only the nearby page (default 25 spins), never the whole history.
 */
export function StationScrubTimeline({
  slug,
  stationName,
}: {
  slug: string;
  stationName: string;
}) {
  const { ride } = usePlayer();

  // sliderPos tracks the handle visually while dragging; `before` is the
  // debounced value that actually drives the fetch.
  const [sliderPos, setSliderPos] = useState(SLIDER_MAX);
  const [before, setBefore] = useState<string | undefined>(undefined);

  const { data, isLoading, isFetching } = useGetStationSpins({
    slug,
    before,
    limit: PAGE_SIZE,
  });

  const bounds = data?.bounds;
  const oldestMs = bounds?.oldestSpinAt ? new Date(bounds.oldestSpinAt).getTime() : null;
  const newestMs = bounds?.newestSpinAt ? new Date(bounds.newestSpinAt).getTime() : null;
  const hasRange = oldestMs != null && newestMs != null && newestMs > oldestMs;

  // Keep the slider snapped to whichever page is actually loaded (e.g. after
  // the initial "most recent" fetch resolves the true newest timestamp).
  useEffect(() => {
    if (before !== undefined) return; // user has started scrubbing
    const anchorMs = data?.tracks[0]?.playedAt
      ? new Date(data.tracks[0].playedAt).getTime()
      : newestMs;
    if (hasRange && anchorMs != null) {
      setSliderPos(
        Math.round(((anchorMs - oldestMs!) / (newestMs! - oldestMs!)) * SLIDER_MAX),
      );
    }
  }, [before, data, hasRange, oldestMs, newestMs]);

  // Debounce the actual data fetch while the user drags the slider.
  useEffect(() => {
    if (!hasRange) return;
    const handle = setTimeout(() => {
      const targetMs = oldestMs! + (sliderPos / SLIDER_MAX) * (newestMs! - oldestMs!);
      // `before` is exclusive of the boundary — nudge forward slightly so a
      // spin sitting exactly at targetMs is still included in the page.
      const nudged = new Date(Math.min(targetMs + 1000, newestMs! + 1000)).toISOString();
      setBefore(nudged);
    }, SCRUB_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sliderPos, hasRange]);

  const tracks = data?.tracks ?? [];
  // Tracks arrive newest-first; chronological order (oldest first) is what a
  // continuation replay should queue.
  const chronological = useMemo(() => [...tracks].reverse(), [tracks]);
  const resolvedChronological = useMemo(
    () => chronological.filter((t) => t.recording != null),
    [chronological],
  );

  const playFrom = (playedAt: string, mbid: string | undefined) => {
    if (resolvedChronological.length === 0) return;
    const startIndex = mbid
      ? Math.max(
          0,
          resolvedChronological.findIndex((t) => t.recording?.mbid === mbid),
        )
      : 0;
    ride.startReplay(
      resolvedChronological.map((t) => ({
        mbid: t.recording!.mbid,
        title: t.recording!.title,
        artist: t.recording!.artist,
        artworkUrl: t.recording!.artworkUrl ?? null,
        links: t.recording!.links ?? [],
      })),
      `${stationName} · scrubbed from ${clockTime(playedAt)}, ${runDate(playedAt)}`,
      { timeOrientation: "past", startIndex },
    );
  };

  const loadOlder = () => {
    if (data?.nextBefore) setBefore(data.nextBefore);
  };

  if (!isLoading && !hasRange) {
    return null; // nothing logged yet for this station — nothing to scrub
  }

  const sliderLabel =
    hasRange && sliderPos != null
      ? new Date(oldestMs! + (sliderPos / SLIDER_MAX) * (newestMs! - oldestMs!))
      : null;

  return (
    <section className="rounded-xl border border-card-border bg-card p-4" data-testid="station-scrub">
      <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
        <History className="h-4 w-4" />
        Scrub the full history
      </div>

      {hasRange ? (
        <>
          <input
            type="range"
            min={0}
            max={SLIDER_MAX}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            data-testid="scrub-slider"
            className="w-full accent-primary"
            aria-label={`Scrub ${stationName}'s spin history`}
          />
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
            <span>{runDate(bounds!.oldestSpinAt!)}</span>
            <span data-testid="scrub-position-label" className="text-foreground">
              {sliderLabel ? `${runDate(sliderLabel.toISOString())} · ${clockTime(sliderLabel.toISOString())}` : ""}
              {isFetching ? " · loading…" : ""}
            </span>
            <span>{runDate(bounds!.newestSpinAt!)}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">
            {bounds!.spinCount} spins logged
          </p>
        </>
      ) : (
        <div className="h-10 animate-pulse rounded-lg bg-muted" />
      )}

      <ol className="mt-4 flex flex-col gap-1.5" data-testid="scrub-nearby-tracks">
        {tracks.map((t) => {
          const rec = t.recording;
          return (
            <li
              key={`${t.position}-${t.playedAt}`}
              className="flex items-center gap-3 rounded-lg border border-card-border/60 bg-background/40 p-2.5"
              data-testid="scrub-track"
            >
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                {t.playedAt ? clockTime(t.playedAt) : ""}
              </span>
              <div className="min-w-0 flex-1">
                {rec ? (
                  <Link
                    href={`/song/${rec.mbid}`}
                    className="block truncate text-sm font-medium text-foreground hover:text-primary"
                  >
                    {rec.title}
                    <span className="text-muted-foreground"> · {rec.artist}</span>
                  </Link>
                ) : (
                  <p className="truncate text-sm text-muted-foreground">
                    {t.rawTitle || "Untitled"}
                    {t.rawArtist ? ` · ${t.rawArtist}` : ""}
                  </p>
                )}
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                  {CONFIDENCE_LABEL[t.confidence] ?? t.confidence}
                </span>
              </div>
              <button
                type="button"
                onClick={() => t.playedAt && playFrom(t.playedAt, rec?.mbid)}
                disabled={!rec}
                data-testid="scrub-play-from-here"
                className="hover-elevate shrink-0 inline-flex items-center gap-1 rounded-full border border-primary-border bg-primary px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-primary-foreground disabled:opacity-30"
                title={rec ? "Play from here" : "Never resolved — can't replay"}
              >
                {rec ? <Play className="h-3 w-3" /> : <Ghost className="h-3 w-3" />}
                From here
              </button>
            </li>
          );
        })}
      </ol>

      {data?.nextBefore ? (
        <button
          type="button"
          onClick={loadOlder}
          data-testid="scrub-load-older"
          className="mt-3 w-full rounded-lg border border-card-border py-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          Load older spins
        </button>
      ) : null}
    </section>
  );
}
