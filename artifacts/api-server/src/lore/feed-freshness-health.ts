/**
 * Tracks per-station feed-freshness state for fixed-size, non-paginating
 * sources (bbc_api, somafm).
 *
 * These adapters return a static window of recent plays (no deep pagination).
 * If the endpoint starts returning fewer items — API change, silent 200 with
 * empty data, or an outage — the poller ingests nothing but never flags it.
 *
 * `recordFeedFreshnessResult` is called after every history-adapter poll:
 *  - "success" when at least one spin was ingested.
 *  - "empty"   when the poll completed but logged === 0.
 *
 * After silence exceeds 2 × the source's poll interval (and there was at
 * least one prior success so we know the station was working), the function
 * returns `shouldWarn: true` exactly once — on the first poll that crosses
 * the threshold — so the caller can emit a structured console.warn. Subsequent
 * empty polls remain silent until the station recovers, preventing log spam.
 *
 * `getFeedFreshnessStaleStations` is the backing source for the admin health
 * endpoint — it returns every tracked station currently over the threshold.
 */

export interface FeedFreshnessState {
  stationId: number;
  slug: string;
  source: string;
  pollIntervalMs: number;
  lastSpinAt: Date | null;
  lastEmptyAt: Date | null;
  consecutiveEmpties: number;
  /** Set when we've already emitted a warn for the current silent run so we
   *  don't repeat it on every tick. Cleared on the next success. */
  warnedAt: Date | null;
}

export interface FeedFreshnessStaleEntry {
  stationId: number;
  slug: string;
  source: string;
  pollIntervalMs: number;
  lastSpinAt: Date | null;
  lastEmptyAt: Date;
  consecutiveEmpties: number;
  staleSinceMs: number;
  thresholdMs: number;
}

const state = new Map<number, FeedFreshnessState>();

/**
 * Record one history-adapter poll result for a tracked station.
 *
 * Returns a warning payload when silence first crosses the 2 × pollIntervalMs
 * threshold (and the station had at least one confirmed success). The caller
 * (poller) emits the console.warn so this module stays pure and testable.
 */
export function recordFeedFreshnessResult(
  stationId: number,
  slug: string,
  source: string,
  kind: "success" | "empty",
  pollIntervalMs: number,
  now: Date = new Date(),
): { shouldWarn: true; lastSpinAt: Date; staleSinceMs: number } | { shouldWarn: false } {
  const existing = state.get(stationId) ?? {
    stationId,
    slug,
    source,
    pollIntervalMs,
    lastSpinAt: null,
    lastEmptyAt: null,
    consecutiveEmpties: 0,
    warnedAt: null,
  };

  if (kind === "success") {
    state.set(stationId, {
      ...existing,
      slug,
      source,
      pollIntervalMs,
      lastSpinAt: now,
      consecutiveEmpties: 0,
      warnedAt: null,
    });
    return { shouldWarn: false };
  }

  // kind === "empty"
  const newEmpties = existing.consecutiveEmpties + 1;
  const updated: FeedFreshnessState = {
    ...existing,
    slug,
    source,
    pollIntervalMs,
    lastEmptyAt: now,
    consecutiveEmpties: newEmpties,
  };
  state.set(stationId, updated);

  // Never warn if we've never seen a successful spin (fresh enrollment with
  // no data yet is not an error).
  if (!existing.lastSpinAt) return { shouldWarn: false };

  const thresholdMs = 2 * pollIntervalMs;
  const staleSinceMs = now.getTime() - existing.lastSpinAt.getTime();
  if (staleSinceMs < thresholdMs) return { shouldWarn: false };

  // Threshold crossed — warn only once per silent run.
  if (existing.warnedAt !== null) return { shouldWarn: false };

  state.set(stationId, { ...updated, warnedAt: now });
  return { shouldWarn: true, lastSpinAt: existing.lastSpinAt, staleSinceMs };
}

/**
 * Return all tracked stations that have been silent for longer than
 * `thresholdMultiplier × pollIntervalMs` (default 2×). Stations that have
 * since recovered (lastSpinAt newer than lastEmptyAt) are excluded.
 */
export function getFeedFreshnessStaleStations(
  thresholdMultiplier: number = 2,
  now: Date = new Date(),
): FeedFreshnessStaleEntry[] {
  const nowMs = now.getTime();
  const stale: FeedFreshnessStaleEntry[] = [];
  for (const entry of state.values()) {
    if (!entry.lastEmptyAt) continue;
    if (
      entry.lastSpinAt &&
      entry.lastSpinAt.getTime() > entry.lastEmptyAt.getTime()
    ) {
      // Recovered — not stale.
      continue;
    }
    if (!entry.lastSpinAt) continue; // Never had a success; not an error.
    const thresholdMs = thresholdMultiplier * entry.pollIntervalMs;
    const staleSinceMs = nowMs - entry.lastSpinAt.getTime();
    if (staleSinceMs >= thresholdMs) {
      stale.push({
        stationId: entry.stationId,
        slug: entry.slug,
        source: entry.source,
        pollIntervalMs: entry.pollIntervalMs,
        lastSpinAt: entry.lastSpinAt,
        lastEmptyAt: entry.lastEmptyAt,
        consecutiveEmpties: entry.consecutiveEmpties,
        staleSinceMs,
        thresholdMs,
      });
    }
  }
  return stale.sort((a, b) => b.staleSinceMs - a.staleSinceMs);
}

/**
 * Remove tracking state for a station (called on unenroll).
 * When `stationId` is omitted, clears all state (used in tests).
 */
export function clearFeedFreshnessState(stationId?: number): void {
  if (stationId === undefined) {
    state.clear();
  } else {
    state.delete(stationId);
  }
}

/** Read-only snapshot of the current in-memory state (for tests). */
export function getFeedFreshnessStateSnapshot(): ReadonlyMap<
  number,
  FeedFreshnessState
> {
  return state;
}
