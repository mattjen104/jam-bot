/**
 * LastSetScanner — a focused sheet for scanning a station's most recent
 * completed set: paged tracklist (page size follows the dial density),
 * hour jump targets, a bounded scrubber, on-demand iTunes previews, and
 * Keep buttons wired to the same resolved/pending-keep flow as live radio.
 *
 * Scan memory (lib/scanMemory.ts) tracks which tracks have been previewed:
 * covered pages are marked on the pager, and reopening the scanner resumes
 * at the first unscanned track after the furthest scanned one. When the
 * station has a newer completed set than the remembered one, the saved
 * progress is stale — the scanner starts fresh and says so.
 *
 * Resource guardrails: preview URLs resolve on demand through the shared
 * single-flight preview cache; only the visible page plus adjacent pages
 * are prefetched, two at a time; a page jump or close is a cancellation
 * boundary for in-flight prefetch and playback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { fetchLatestSet, formatSetHours, type LatestSet } from "../lib/latestSet";
import { dialPageSize, type DialDensity } from "../lib/dialDensityState";
import { clockTime, runDate } from "../lib/format";
import { proxyArtUrl } from "../lib/proxyArt";
import {
  getSetScanProgress,
  hasStaleSetScan,
  recordSetScan,
  useScanMemory,
} from "../lib/scanMemory";
import { getPreviewCached } from "../player/previewCache";
import { KeepButton } from "./KeepButton";

export interface LastSetScannerProps {
  slug: string;
  /** Page size follows the active dial density: 5 normal / 10 compact / 15 micro. */
  density: DialDensity;
  /** artist (lowercase) → artwork URL from the listener's cached library —
   *  crossing rows get the Library behind-row art treatment. */
  libraryArtwork: ReadonlyMap<string, string>;
  /** Lifetime crossing count for the header line (exact + artist-level). */
  lifetimeCrossings: number;
  onClose: () => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "ready"; data: LatestSet };

/** Concurrent preview-resolution workers for page prefetching. */
const PREFETCH_CONCURRENCY = 2;

export function LastSetScanner({
  slug,
  density,
  libraryArtwork,
  lifetimeCrossings,
  onClose,
}: LastSetScannerProps) {
  // Load results are tagged with the slug they were fetched for, so a slug
  // change derives "loading" without a synchronous setState inside the
  // effect body (react-hooks/set-state-in-effect).
  const [loaded, setLoaded] = useState<
    | { slug: string; kind: "ready"; data: LatestSet }
    | { slug: string; kind: "empty" }
    | { slug: string; kind: "error" }
    | null
  >(null);
  const [page, setPage] = useState(0);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  const [noPreviewIdx, setNoPreviewIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Bumped on every page jump/close/play — stale async work checks it. */
  const playToken = useRef(0);
  const prefetchToken = useRef(0);
  const scanMemory = useScanMemory();

  // ── modal focus lifecycle: focus the sheet on open, restore on close ────
  useEffect(() => {
    const prev =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>(".setscanner__close")?.focus();
    return () => prev?.focus();
  }, []);

  // Keep Tab cycling inside the sheet while it is open.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const state: LoadState =
    loaded && loaded.slug === slug ? loaded : { kind: "loading" };
  const pageSize = dialPageSize(density);
  const data = state.kind === "ready" ? state.data : null;
  const tracks = useMemo(() => data?.tracks ?? [], [data]);
  const pageCount = Math.max(1, Math.ceil(tracks.length / pageSize));

  // ── load ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController();
    fetchLatestSet(slug, ac.signal)
      .then((d) =>
        setLoaded(d ? { slug, kind: "ready", data: d } : { slug, kind: "empty" }),
      )
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoaded({ slug, kind: "error" });
      });
    return () => ac.abort();
  }, [slug]);

  // ── resume from scan memory (once per loaded set) ───────────────────────
  // Render-time adjustment, same pattern as SplitHome's scan-offset clamp:
  // deriving the initial page from newly-arrived data. Forward-biased —
  // resume at the first unscanned track after the furthest scanned one.
  const runKey = data ? `${slug}:${data.run.runId}` : null;
  const [resumedKey, setResumedKey] = useState<string | null>(null);
  if (data && runKey && resumedKey !== runKey) {
    setResumedKey(runKey);
    const progress = getSetScanProgress(slug, data.run.runId, tracks.length);
    if (progress) setPage(Math.floor(progress.resumeIndex / pageSize));
  }

  const scanned = useMemo(() => {
    if (!data) return new Set<number>();
    const entry = scanMemory.sets[slug];
    if (!entry || entry.runId !== data.run.runId) return new Set<number>();
    return new Set(entry.scanned);
  }, [scanMemory, data, slug]);

  const stalePreviousSet = data != null && hasStaleSetScan(slug, data.run.runId);

  // ── preview playback (one sample at a time) ─────────────────────────────
  const stopPreview = useCallback(() => {
    playToken.current += 1;
    audioRef.current?.pause();
    setPlayingIdx(null);
    setLoadingIdx(null);
  }, []);

  const togglePreview = useCallback(
    (index: number) => {
      const track = tracks[index];
      if (!track) return;
      if (playingIdx === index || loadingIdx === index) {
        stopPreview();
        return;
      }
      stopPreview();
      setNoPreviewIdx(null);
      // A preview attempt is what "scanned" means for set progress.
      if (data) recordSetScan(slug, data.run.runId, index);
      if (!track.mbid) {
        setNoPreviewIdx(index);
        return;
      }
      const token = playToken.current;
      setLoadingIdx(index);
      void getPreviewCached(track.mbid)
        .then((p) => {
          if (token !== playToken.current) return; // jumped/closed meanwhile
          setLoadingIdx(null);
          if (!p.previewUrl) {
            setNoPreviewIdx(index);
            return;
          }
          let el = audioRef.current;
          if (!el) {
            el = new Audio();
            el.addEventListener("ended", () => setPlayingIdx(null));
            audioRef.current = el;
          }
          el.src = p.previewUrl;
          el.play()
            .then(() => {
              if (token === playToken.current) setPlayingIdx(index);
            })
            .catch(() => setPlayingIdx(null));
        })
        .catch(() => {
          // Transient resolution failure — nothing cached; just stop loading.
          if (token === playToken.current) setLoadingIdx(null);
        });
    },
    [tracks, playingIdx, loadingIdx, stopPreview, data, slug],
  );

  // ── bounded prefetch: visible page + adjacent pages, small concurrency ──
  useEffect(() => {
    if (!data) return;
    prefetchToken.current += 1;
    const token = prefetchToken.current;
    const pages = [page, page + 1, page - 1].filter((p) => p >= 0 && p < pageCount);
    const queue: string[] = [];
    for (const p of pages) {
      for (let i = p * pageSize; i < Math.min((p + 1) * pageSize, tracks.length); i++) {
        const mbid = tracks[i]?.mbid;
        if (mbid && !queue.includes(mbid)) queue.push(mbid);
      }
    }
    let cursor = 0;
    const workers = Array.from({ length: PREFETCH_CONCURRENCY }, async () => {
      while (cursor < queue.length) {
        if (token !== prefetchToken.current) return; // cancelled by jump/close
        const mbid = queue[cursor++];
        if (!mbid) continue;
        try {
          await getPreviewCached(mbid);
        } catch {
          // transient — the cache deliberately stores nothing on rejection
        }
      }
    });
    void Promise.all(workers);
    return () => {
      prefetchToken.current += 1;
    };
  }, [data, page, pageCount, pageSize, tracks]);

  // ── close = cancellation boundary ────────────────────────────────────────
  const handleClose = useCallback(() => {
    stopPreview();
    prefetchToken.current += 1;
    onClose();
  }, [stopPreview, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  // Stop audio + cancel prefetch if the sheet unmounts without close.
  useEffect(
    () => () => {
      playToken.current += 1;
      prefetchToken.current += 1;
      audioRef.current?.pause();
    },
    [],
  );

  // ── hour jump targets: first track index of each distinct local hour ────
  const hourJumps = useMemo(() => {
    const seen = new Map<string, number>();
    tracks.forEach((t, i) => {
      const label = clockTime(t.playedAt).replace(/:\d{2}\s?/, "");
      if (!seen.has(label)) seen.set(label, i);
    });
    return [...seen.entries()].map(([label, index]) => ({ label, index }));
  }, [tracks]);

  const jumpToIndex = useCallback(
    (index: number) => {
      stopPreview();
      setPage(Math.floor(Math.min(Math.max(index, 0), tracks.length - 1) / pageSize));
    },
    [stopPreview, tracks.length, pageSize],
  );

  const pageStart = page * pageSize;
  const pageTracks = tracks.slice(pageStart, pageStart + pageSize);
  const isPageCovered = (p: number) => {
    const start = p * pageSize;
    const end = Math.min(start + pageSize, tracks.length);
    if (start >= end) return false;
    for (let i = start; i < end; i++) if (!scanned.has(i)) return false;
    return true;
  };

  return (
    <div
      className="setscanner"
      role="dialog"
      aria-modal="true"
      aria-label={`${data?.station.name ?? slug} last set scanner`}
      onKeyDown={trapTab}
    >
      <div className="setscanner__panel" ref={panelRef}>
        <div className="setscanner__header">
          <div className="setscanner__title">
            {data ? (
              <>
                <span className="setscanner__station">{data.station.name} — Last set</span>
                <span className="setscanner__meta">
                  {data.run.show?.name ?? "Station stream"} · {runDate(data.run.date)} ·{" "}
                  {formatSetHours(data.run.startedAt, data.run.endedAt)} · {data.run.spinCount} tracks
                  {lifetimeCrossings > 0 && ` · ${lifetimeCrossings} crossing${lifetimeCrossings === 1 ? "" : "s"} all-time`}
                </span>
              </>
            ) : (
              <span className="setscanner__station">Last set</span>
            )}
          </div>
          <button
            type="button"
            className="setscanner__close"
            aria-label="Close scanner"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {stalePreviousSet && (
          <p className="setscanner__note" data-testid="setscanner-stale-note">
            You scanned part of the previous set — this is a newer one.
          </p>
        )}

        {state.kind === "loading" && (
          <p className="setscanner__status">Loading the last set…</p>
        )}
        {state.kind === "error" && (
          <p className="setscanner__status setscanner__status--error">
            Couldn't load this station's last set.
          </p>
        )}
        {state.kind === "empty" && (
          <p className="setscanner__status" data-testid="setscanner-empty">
            No completed set on record for this station yet.
          </p>
        )}

        {data && (
          <>
            {/* Hour jumps + bounded scrubber */}
            <div className="setscanner__nav">
              <div className="setscanner__hours">
                {hourJumps.map((h, i) => (
                  <button
                    key={h.label}
                    type="button"
                    className="setscanner__hour"
                    data-testid={`setscanner-hour-${i}`}
                    onClick={() => jumpToIndex(h.index)}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
              <input
                type="range"
                className="setscanner__scrubber"
                data-testid="setscanner-scrubber"
                aria-label="Set position"
                min={0}
                max={Math.max(0, tracks.length - 1)}
                value={Math.min(pageStart, Math.max(0, tracks.length - 1))}
                onChange={(e) => jumpToIndex(Number(e.target.value))}
              />
            </div>

            <ol className="setscanner__list">
              {pageTracks.map((t, i) => {
                const index = pageStart + i;
                const artistKey = t.artist.trim().toLowerCase();
                const isCrossing = artistKey.length > 0 && libraryArtwork.has(artistKey);
                const art = isCrossing
                  ? (libraryArtwork.get(artistKey) ?? t.artworkUrl)
                  : null;
                const proxied = art ? (proxyArtUrl(art) ?? art) : null;
                const isPlaying = playingIdx === index;
                const isLoading = loadingIdx === index;
                return (
                  <li
                    key={`${t.spinId}`}
                    className={[
                      "setscanner__track",
                      isCrossing ? "setscanner__track--crossing" : "",
                      scanned.has(index) ? "setscanner__track--scanned" : "",
                    ].filter(Boolean).join(" ")}
                    data-testid={`setscanner-track-${index}`}
                  >
                    {isCrossing && proxied && (
                      <>
                        <img
                          className="setscanner__track-bg-art"
                          src={proxied}
                          alt=""
                          aria-hidden="true"
                          loading="lazy"
                        />
                        <span className="setscanner__track-bg-overlay" aria-hidden="true" />
                      </>
                    )}
                    <button
                      type="button"
                      className="setscanner__preview"
                      aria-label={
                        isPlaying
                          ? `Stop preview of ${t.title} by ${t.artist}`
                          : `Play preview of ${t.title} by ${t.artist}`
                      }
                      aria-pressed={isPlaying}
                      disabled={isLoading}
                      data-testid={`setscanner-preview-${index}`}
                      onClick={() => togglePreview(index)}
                    >
                      {isLoading ? "…" : isPlaying ? "■" : "▶"}
                    </button>
                    <span className="setscanner__track-text">
                      <span className="setscanner__track-artist">{t.artist}</span>
                      {t.title && (
                        <span className="setscanner__track-title"> — {t.title}</span>
                      )}
                    </span>
                    <span className="setscanner__track-time">{clockTime(t.playedAt)}</span>
                    {scanned.has(index) && (
                      <span
                        className="setscanner__scanned-mark"
                        title="Already scanned"
                        aria-label={`${t.title} already scanned`}
                      >
                        ✓
                      </span>
                    )}
                    {noPreviewIdx === index && (
                      <span className="setscanner__no-preview">no sample</span>
                    )}
                    <span onClick={(e) => e.stopPropagation()}>
                      <KeepButton
                        mbid={t.mbid}
                        spinId={t.spinId}
                        provenance={{ stationSlug: slug, stationName: data.station.name }}
                        compact
                      />
                    </span>
                  </li>
                );
              })}
            </ol>

            {/* Pager — same page grammar as the station picker; covered pages
                are marked so the listener can skip ahead. */}
            {pageCount > 1 && (
              <div className="setscanner__pager">
                {Array.from({ length: pageCount }, (_, p) => {
                  const covered = isPageCovered(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      className={[
                        "setscanner__page",
                        p === page ? "setscanner__page--current" : "",
                        covered ? "setscanner__page--covered" : "",
                      ].filter(Boolean).join(" ")}
                      aria-label={`Page ${p + 1}${covered ? " (scanned)" : ""}`}
                      aria-current={p === page ? "true" : undefined}
                      title={covered ? "Already scanned" : undefined}
                      data-testid={`setscanner-page-${p + 1}`}
                      onClick={() => jumpToIndex(p * pageSize)}
                    >
                      {p + 1}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
