/**
 * useDialNavigation — coarse/fine run-navigation state for the Dial's
 * past-mode timeline, plus the swipe handler that drives fine steps.
 *
 * Extracted from DialView.tsx so the navigation state machine can be
 * understood and tested independently of the component tree.
 *
 * Exports:
 *   findRunIndexByHour — density-spine hour → coarse run index mapping
 *   usePastScanState   — two-level coarse/fine navigation state machine
 *   useSwipeHandler    — horizontal swipe detection for fine steps
 */
import { useState, useRef, useCallback } from "react";
import type React from "react";
import { type OverlapRun } from "../lib/meHooks";

/**
 * Find the index of the run in `runs` whose UTC broadcast day is nearest to
 * `hourMs` (epoch milliseconds). Returns 0 when the list is empty.
 *
 * Used by the density-spine tap/drag handlers to convert an hour position
 * into a coarse scan detent. Exported for unit testing in dialPastScan.test.tsx.
 */
export function findRunIndexByHour(hourMs: number, runs: OverlapRun[]): number {
  if (runs.length === 0) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    // Use noon UTC for the run's day to produce a stable representative time.
    const runDayMs = new Date(run.day + "T12:00:00Z").getTime();
    const dist = Math.abs(runDayMs - hourMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * Touch-swipe handler that fires onSwipeLeft / onSwipeRight.
 *
 * Guards:
 *   - Left-edge exclusion (20 px default): touches starting within that zone
 *     are ignored — iOS Safari uses it for back-navigation.
 *   - Axis guard: swipe fires only when |dx| > |dy|, so vertical scrolling
 *     in any parent container is never hijacked.
 *   - Min distance (40 px default): micro-movements are ignored.
 *
 * Attach via `<div {...swipeHandlers}>` on the now-playing card wrapper.
 */
export function useSwipeHandler(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  {
    leftEdgeExcludePx = 20,
    minDistPx = 40,
  }: { leftEdgeExcludePx?: number; minDistPx?: number } = {},
) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      if (touch.clientX < leftEdgeExcludePx) return; // iOS Safari back-nav zone
      startX.current = touch.clientX;
      startY.current = touch.clientY;
    },
    [leftEdgeExcludePx],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (startX.current === null || startY.current === null) return;
      const touch = e.changedTouches[0];
      if (!touch) {
        startX.current = null;
        startY.current = null;
        return;
      }
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;
      startX.current = null;
      startY.current = null;
      // Axis guard: ignore if primarily vertical or too short.
      if (Math.abs(dx) < minDistPx || Math.abs(dy) >= Math.abs(dx)) return;
      if (dx < 0) onSwipeLeft();
      else onSwipeRight();
    },
    [minDistPx, onSwipeLeft, onSwipeRight],
  );

  return { onTouchStart, onTouchEnd };
}

/**
 * Two-level scan state for the dial's past-mode navigation.
 *
 * Coarse level: crossing runs (reverse-chronological, from useMyOverlapRunsRecent).
 *   Index 0 = most recent run, index N-1 = oldest.
 * Fine level:   crossing moments within the landed run.
 *
 * Window constants (from measured density):
 *   COARSE_WINDOW_SIZE = 60 runs — at 135 crossings/24h → ~39 runs/day for a
 *   heavy user; 60 provides ~1.5 days of comfortable coarse-detent coverage.
 *   N (fine) is bounded by the run size; typically 2–10 moments per run.
 *
 * Navigation contract:
 *   prevRun()               → older run (idx++); at live edge → idx 0
 *   nextRun()               → newer run (idx--); resists at live edge (null)
 *   jumpToRunByIndex(idx)   → absolute coarse position (spine drag)
 *   jumpToRunByHour(hourMs) → nearest run by day (spine bin tap)
 *   prevCrossing(n)         → earlier crossing (swipe right)
 *   nextCrossing(n)         → later crossing (swipe left); resists at last stop
 *   reset()                 → return to live edge, clear fine state
 *
 * State machine does NOT fork: every coarse navigation call resets fineIdx.
 */
export function usePastScanState(coarseCands: OverlapRun[]) {
  const [coarseIdx, setCoarseIdx] = useState<number | null>(null);
  const [fineIdx, setFineIdx] = useState<number | null>(null);
  const coarseCount = coarseCands.length;

  // The candidate list can shrink under us (e.g. the dial range is narrowed
  // while stepped back). Clamp the coarse position so currentRun never reads
  // past the end of the array. Deriving this during render (instead of in an
  // effect) keeps the clamped index consistent within the same commit and
  // avoids a synchronous setState-in-effect cascade.
  if (coarseIdx !== null && coarseIdx >= coarseCount) {
    setCoarseIdx(coarseCount > 0 ? coarseCount - 1 : null);
    setFineIdx(null);
  }

  // Internal setter: updates coarse and resets fine whenever the index changes.
  const setCoarseWithFineReset = useCallback(
    (fn: (prev: number | null) => number | null) => {
      setCoarseIdx((prev) => {
        const next = fn(prev);
        if (next !== prev) setFineIdx(null);
        return next;
      });
    },
    [],
  );

  /** Step to the next older run (coarseIdx++). At live edge, enters most-recent run. */
  const prevRun = useCallback(() => {
    setCoarseWithFineReset((i) =>
      i === null ? (coarseCount > 0 ? 0 : null) : Math.min(i + 1, coarseCount - 1),
    );
  }, [coarseCount, setCoarseWithFineReset]);

  /** Step to the next newer run (coarseIdx--). Resists at live edge (stays null). */
  const nextRun = useCallback(() => {
    setCoarseWithFineReset((i) => (i === null || i === 0 ? null : i - 1));
  }, [setCoarseWithFineReset]);

  /** Jump to an absolute coarse index — used by density-spine drag. */
  const jumpToRunByIndex = useCallback(
    (idx: number) => {
      if (idx >= 0 && idx < coarseCount) {
        setCoarseWithFineReset(() => idx);
      }
    },
    [coarseCount, setCoarseWithFineReset],
  );

  /**
   * Jump to the run nearest to `hourMs` (epoch ms) by day — used by density-
   * spine tap. Delegates nearest-run lookup to findRunIndexByHour.
   */
  const jumpToRunByHour = useCallback(
    (hourMs: number) => {
      if (coarseCands.length === 0) return;
      setCoarseWithFineReset(() => findRunIndexByHour(hourMs, coarseCands));
    },
    [coarseCands, setCoarseWithFineReset],
  );

  /** Step to the earlier crossing within the run (swipe right). */
  const prevCrossing = useCallback((fineCount: number) => {
    if (fineCount === 0) return;
    setFineIdx((i) => (i === null ? fineCount - 1 : Math.max(i - 1, 0)));
  }, []);

  /**
   * Step to the later crossing within the run (swipe left).
   * Resists at the last fine stop — never silently advances past the run.
   */
  const nextCrossing = useCallback((fineCount: number) => {
    if (fineCount === 0) return;
    setFineIdx((i) => {
      const cur = i ?? -1;
      return cur >= fineCount - 1 ? Math.max(cur, 0) : cur + 1;
    });
  }, []);

  /** Return to live edge and clear fine state. */
  const reset = useCallback(() => {
    setCoarseIdx(null);
    setFineIdx(null);
  }, []);

  /**
   * Jump directly to a fine crossing by index — used by crossing row clicks
   * so the active class and subsequent swipes continue from the clicked position.
   */
  const jumpToFine = useCallback((idx: number, fineCount: number) => {
    if (idx >= 0 && idx < fineCount) {
      setFineIdx(idx);
    }
  }, []);

  const currentRun = coarseIdx !== null ? (coarseCands[coarseIdx] ?? null) : null;

  return {
    coarseIdx,
    fineIdx,
    currentRun,
    isAtLiveEdge: coarseIdx === null,
    prevRun,
    nextRun,
    jumpToRunByIndex,
    jumpToRunByHour,
    jumpToFine,
    prevCrossing,
    nextCrossing,
    reset,
  };
}
