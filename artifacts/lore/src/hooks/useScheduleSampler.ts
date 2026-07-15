import { useCallback, useEffect, useRef, useState } from "react";
import { getStationSpins, getRecordingPreview } from "@workspace/api-client-react";

const CLIP_DURATION_MS = 6000;
const HOVER_DELAY_MS = 400;
const MAX_TRACKS = 5;

const DOW_TO_IDX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Compute the start/end Date of the most recent occurrence of a recurring show.
 * Falls back gracefully if dayOfWeek is unrecognised or times can't be parsed.
 */
function mostRecentOccurrenceWindow(
  dayOfWeek: string,
  startTime: string,
  endTime: string | null,
): { windowStart: Date; windowEnd: Date } {
  const targetDow = DOW_TO_IDX[dayOfWeek] ?? new Date().getDay();
  const now = new Date();
  const daysDiff = (now.getDay() - targetDow + 7) % 7;

  const occurrenceDate = new Date(now);
  occurrenceDate.setDate(occurrenceDate.getDate() - daysDiff);

  const [startH = 0, startM = 0] = startTime.split(":").map(Number);
  const windowStart = new Date(occurrenceDate);
  windowStart.setHours(startH, startM, 0, 0);

  let windowEnd: Date;
  if (endTime) {
    const [endH = 0, endM = 0] = endTime.split(":").map(Number);
    windowEnd = new Date(occurrenceDate);
    windowEnd.setHours(endH, endM, 0, 0);
    // Overnight: endTime is next calendar day
    if (windowEnd <= windowStart) windowEnd.setDate(windowEnd.getDate() + 1);
  } else {
    // No endTime listed — assume 2-hour window
    windowEnd = new Date(windowStart.getTime() + 2 * 60 * 60 * 1000);
  }

  // If the computed start is in the future, step back one full week
  if (windowStart > now) {
    windowStart.setDate(windowStart.getDate() - 7);
    windowEnd.setDate(windowEnd.getDate() - 7);
  }

  return { windowStart, windowEnd };
}

/** Resolve preview URLs for a list of MBIDs, skipping those with no preview. */
async function resolvePreviewUrls(
  mbids: string[],
  signal: AbortSignal,
): Promise<string[]> {
  const results = await Promise.all(
    mbids.map(async (mbid) => {
      try {
        const p = await getRecordingPreview(mbid, { signal });
        return p.previewUrl ?? null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((url): url is string => url != null);
}

/**
 * Fetch the last N spins for a station, scoped to the most recent occurrence
 * of the given show's time window. Falls back to the latest station-wide spins
 * when no spins are logged in the window (e.g. the show just started or the
 * station has no window-scoped data yet).
 */
async function resolveStationPreviews(
  stationSlug: string,
  signal: AbortSignal,
  dayOfWeek: string,
  startTime: string,
  endTime: string | null,
): Promise<string[]> {
  const { windowStart, windowEnd } = mostRecentOccurrenceWindow(
    dayOfWeek,
    startTime,
    endTime,
  );

  // Fetch spins up to the show's end time with extra headroom to find in-window ones
  const page = await getStationSpins(
    { slug: stationSlug, before: windowEnd.toISOString(), limit: 30 },
    { signal },
  );

  const windowStartMs = windowStart.getTime();

  // Filter to spins that actually aired within this show's window
  const inWindowMbids = page.tracks
    .filter((t) => {
      if (!t.playedAt) return false;
      return new Date(t.playedAt).getTime() >= windowStartMs;
    })
    .map((t) => t.recording?.mbid)
    .filter((id): id is string => Boolean(id))
    .slice(0, MAX_TRACKS);

  if (inWindowMbids.length > 0) {
    return resolvePreviewUrls(inWindowMbids, signal);
  }

  // Graceful fallback: no spins logged in this show's window yet — use the
  // most recent station-wide spins so hover still gives a taste of the station.
  const fallbackMbids = page.tracks
    .map((t) => t.recording?.mbid)
    .filter((id): id is string => Boolean(id))
    .slice(0, MAX_TRACKS);

  return resolvePreviewUrls(fallbackMbids, signal);
}

/**
 * Side-channel audio player for the schedule sampler.
 * Completely independent from PlayerProvider — its own HTMLAudioElement.
 * Plays preview URLs sequentially at ~6 s each (hard cut, no crossfade).
 * Calls `onDone` when the sequence ends naturally (all clips played / none available).
 */
function useSamplerPlayer(onDone: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlsRef = useRef<string[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Always-fresh playAt — avoids stale closure in recursive setTimeout calls.
  const playAtRef = useRef<(idx: number) => void>(() => {});
  const [isSampling, setIsSampling] = useState(false);

  useEffect(() => {
    if (typeof Audio === "undefined") return;
    const el = new Audio();
    el.preload = "none";
    el.volume = 0.6;
    audioRef.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
    };
  }, []);

  playAtRef.current = (idx: number) => {
    const urls = urlsRef.current;
    if (idx >= urls.length) {
      setIsSampling(false);
      onDoneRef.current();
      return;
    }
    const el = audioRef.current;
    if (!el) return;
    el.src = urls[idx]!;
    el.currentTime = 0;
    void el.play().catch(() => {
      // Skip unplayable clip silently
      playAtRef.current(idx + 1);
    });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      playAtRef.current(idx + 1);
    }, CLIP_DURATION_MS);
  };

  const start = useCallback((urls: string[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    if (urls.length === 0) {
      // Nothing to play — fire onDone immediately so caller can clear state
      setIsSampling(false);
      onDoneRef.current();
      return;
    }
    urlsRef.current = urls;
    setIsSampling(true);
    playAtRef.current(0);
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    urlsRef.current = [];
    setIsSampling(false);
  }, []);

  return { start, stop, isSampling };
}

/**
 * Unique key for a scheduled slot — includes dateKey (e.g. "2026-07-14") so
 * the same recurring show on different calendar days never collides.
 */
export function makeSlotKey(
  stationSlug: string,
  dateKey: string,
  startTime: string,
): string {
  return `${stationSlug}::${dateKey}::${startTime}`;
}

/**
 * Schedule-level sampler controller. Mount once at the ScheduleCalendar level.
 *
 * Usage:
 *   const { onSlotEnter, onSlotLeave, isSlotActive } = useScheduleSampler();
 *
 * `isSlotActive(slug, dateKey, startTime)` returns true while the slot is
 * either fetching previews or playing — drives the scanning indicator.
 * It automatically clears when playback ends or no previews resolve.
 */
export function useScheduleSampler() {
  // Key of the currently active slot (fetch pending OR playback in progress).
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // True while the async fetch+resolve pipeline is running.
  const [isFetching, setIsFetching] = useState(false);

  const clearActive = useCallback(() => {
    setActiveKey(null);
    setIsFetching(false);
  }, []);

  const { start, stop, isSampling } = useSamplerPlayer(clearActive);

  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onSlotEnter = useCallback(
    (
      stationSlug: string,
      dateKey: string,
      startTime: string,
      dayOfWeek: string,
      endTime: string | null,
    ) => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

      hoverTimerRef.current = setTimeout(() => {
        void (async () => {
          abortRef.current?.abort();
          const ac = new AbortController();
          abortRef.current = ac;

          const key = makeSlotKey(stationSlug, dateKey, startTime);
          setActiveKey(key);
          setIsFetching(true);

          try {
            const urls = await resolveStationPreviews(
              stationSlug,
              ac.signal,
              dayOfWeek,
              startTime,
              endTime,
            );
            if (ac.signal.aborted) return;
            setIsFetching(false);
            // start() fires onDone (= clearActive) if urls is empty
            start(urls);
          } catch {
            // Abort or network error — clear the indicator silently
            if (!ac.signal.aborted) {
              setIsFetching(false);
              setActiveKey(null);
            }
          }
        })();
      }, HOVER_DELAY_MS);
    },
    [start],
  );

  const onSlotLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setActiveKey(null);
    setIsFetching(false);
    stop();
  }, [stop]);

  /** True while this slot is pending fetch or actively playing audio. */
  const isSlotActive = useCallback(
    (stationSlug: string, dateKey: string, startTime: string) =>
      (isFetching || isSampling) &&
      activeKey === makeSlotKey(stationSlug, dateKey, startTime),
    [isFetching, isSampling, activeKey],
  );

  return { onSlotEnter, onSlotLeave, isSlotActive };
}
