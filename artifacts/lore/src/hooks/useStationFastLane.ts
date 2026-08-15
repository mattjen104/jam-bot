/**
 * useStationFastLane — station-landing fast-lane revalidation.
 *
 * When the listener stops the scan on (or tunes directly to) a station, the
 * Dial's aggregate now-playing snapshot can be up to a poll cycle old. This
 * hook fetches that one station's freshest stored state from the server's
 * fast-lane endpoint (`/api/player/station/:slug/now`) in parallel with
 * starting audio. If the server reports it triggered a one-shot source
 * refresh (the stored state exceeded its freshness budget), the hook briefly
 * re-checks so the corrected track lands within a few seconds. Whenever a
 * result differs from the candidate the listener landed on, `onFreshTrack`
 * fires so the caller can reconcile the displayed track.
 */
import { useCallback, useEffect, useRef } from "react";

export interface FastLaneNow {
  mbid: string | null;
  artistMbid: string | null;
  title: string;
  artist: string;
  artworkUrl: string | null;
  releaseYear: number | null;
  playedAt: string;
  observedAt: string;
  freshness: "fresh" | "aging" | "stale";
  resolved: boolean;
}

export interface FastLaneResponse {
  station: { slug: string; name: string };
  now: FastLaneNow | null;
  refreshTriggered: boolean;
}

/** The track the listener believes is playing at landing time. */
export interface FastLaneCandidate {
  mbid: string | null;
  title: string;
  artist: string;
}

/** Post-refresh re-check schedule (ms after landing response). */
export const FAST_LANE_RECHECK_DELAYS_MS: readonly number[] = [2500, 5000];

/**
 * Does the fast-lane result name a different track than the landing
 * candidate? MBIDs win when both sides have one; otherwise compare
 * normalized text. No candidate at all ⇒ any result is news.
 */
export function tracksDiffer(
  candidate: FastLaneCandidate | null | undefined,
  next: FastLaneNow,
): boolean {
  if (!candidate) return true;
  if (candidate.mbid && next.mbid) return candidate.mbid !== next.mbid;
  const norm = (s: string) => s.trim().toLowerCase();
  return (
    norm(candidate.title) !== norm(next.title) ||
    norm(candidate.artist) !== norm(next.artist)
  );
}

export function useStationFastLane(
  onFreshTrack: (slug: string, now: FastLaneNow) => void,
): { landOnStation: (slug: string, candidate: FastLaneCandidate | null) => void } {
  // Latest callback in a ref so landOnStation stays referentially stable.
  const cbRef = useRef(onFreshTrack);
  useEffect(() => { cbRef.current = onFreshTrack; }, [onFreshTrack]);

  // Pending re-check timers per slug — a new landing on the same station
  // supersedes any in-flight re-check schedule.
  const timersRef = useRef(new Map<string, number[]>());

  const clearSlugTimers = useCallback((slug: string) => {
    const ids = timersRef.current.get(slug);
    if (ids) {
      for (const id of ids) window.clearTimeout(id);
      timersRef.current.delete(slug);
    }
  }, []);

  const landOnStation = useCallback(
    (slug: string, candidate: FastLaneCandidate | null) => {
      clearSlugTimers(slug);

      const check = async (): Promise<boolean> => {
        const res = await fetch(
          `/api/player/station/${encodeURIComponent(slug)}/now`,
          { headers: { "Content-Type": "application/json" } },
        );
        if (!res.ok) return false;
        const body = (await res.json()) as FastLaneResponse;
        if (body.now && tracksDiffer(candidate, body.now)) {
          cbRef.current(slug, body.now);
        }
        return body.refreshTriggered;
      };

      void check()
        .then((refreshTriggered) => {
          if (!refreshTriggered) return;
          // The server kicked a one-shot source refresh — briefly re-check so
          // the corrected track lands. Re-checks never reschedule themselves
          // (the server debounces further refreshes anyway).
          const ids = FAST_LANE_RECHECK_DELAYS_MS.map((delay) =>
            window.setTimeout(() => {
              void check().catch(() => { /* transient — landing is best-effort */ });
            }, delay),
          );
          timersRef.current.set(slug, ids);
        })
        .catch(() => { /* transient — landing is best-effort */ });
    },
    [clearSlugTimers],
  );

  // Unmount: cancel every pending re-check.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const ids of timers.values()) {
        for (const id of ids) window.clearTimeout(id);
      }
      timers.clear();
    };
  }, []);

  return { landOnStation };
}
