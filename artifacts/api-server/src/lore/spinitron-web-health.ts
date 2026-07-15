/**
 * Tracks per-station null-result state for the spinitron_web now-playing adapter.
 *
 * When the Spinitron HTML scraper returns null (page structure changed, blocked,
 * or empty), the poller calls `recordSpinitronWebResult` with `kind: "null"`.
 * After the first null following a confirmed success, the poller emits a
 * structured warning (source, stationId, slug, lastSuccessAt) so an operator
 * can see the problem without waiting for user complaints.
 *
 * `getSpinitronWebStaleStations` is the backing source for the admin health
 * endpoint — it returns every station whose scraper has been returning null
 * for longer than `thresholdMs` (default 10 minutes).
 */

export const DEFAULT_STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface SpinitronWebStationState {
  stationId: number;
  slug: string;
  lastSuccessAt: Date | null;
  lastNullAt: Date | null;
  consecutiveNulls: number;
}

export interface SpinitronWebStaleEntry {
  stationId: number;
  slug: string;
  lastSuccessAt: Date | null;
  lastNullAt: Date;
  consecutiveNulls: number;
  staleSinceMs: number;
}

const state = new Map<number, SpinitronWebStationState>();

/**
 * Record one adapter result for a spinitron_web station.
 *
 * Returns a warning payload when the station transitions from "was working"
 * to "returning null" for the first time in a run of consecutive nulls.
 * The caller (poller) emits the console.warn so this module stays pure and
 * easy to unit-test.
 */
export function recordSpinitronWebResult(
  stationId: number,
  slug: string,
  kind: "success" | "null",
  now: Date = new Date(),
): { shouldWarn: true; lastSuccessAt: Date } | { shouldWarn: false } {
  const existing = state.get(stationId) ?? {
    stationId,
    slug,
    lastSuccessAt: null,
    lastNullAt: null,
    consecutiveNulls: 0,
  };

  if (kind === "success") {
    state.set(stationId, {
      ...existing,
      slug,
      lastSuccessAt: now,
      consecutiveNulls: 0,
    });
    return { shouldWarn: false };
  }

  const newNulls = existing.consecutiveNulls + 1;
  state.set(stationId, {
    ...existing,
    slug,
    lastNullAt: now,
    consecutiveNulls: newNulls,
  });

  if (existing.lastSuccessAt !== null && newNulls === 1) {
    return { shouldWarn: true, lastSuccessAt: existing.lastSuccessAt };
  }
  return { shouldWarn: false };
}

/**
 * Return all spinitron_web stations that have been returning null for longer
 * than `thresholdMs`. Stations that have since recovered (lastSuccessAt newer
 * than lastNullAt) are excluded.
 */
export function getSpinitronWebStaleStations(
  thresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
  now: Date = new Date(),
): SpinitronWebStaleEntry[] {
  const nowMs = now.getTime();
  const stale: SpinitronWebStaleEntry[] = [];
  for (const entry of state.values()) {
    if (!entry.lastNullAt) continue;
    if (
      entry.lastSuccessAt &&
      entry.lastSuccessAt.getTime() > entry.lastNullAt.getTime()
    ) {
      continue;
    }
    const staleSinceMs = nowMs - entry.lastNullAt.getTime();
    if (staleSinceMs >= thresholdMs) {
      stale.push({
        stationId: entry.stationId,
        slug: entry.slug,
        lastSuccessAt: entry.lastSuccessAt,
        lastNullAt: entry.lastNullAt,
        consecutiveNulls: entry.consecutiveNulls,
        staleSinceMs,
      });
    }
  }
  return stale.sort((a, b) => b.staleSinceMs - a.staleSinceMs);
}

/**
 * Remove tracking state for a station (called when a station is unenrolled).
 * When `stationId` is omitted, clears all state (used in tests).
 */
export function clearSpinitronWebState(stationId?: number): void {
  if (stationId === undefined) {
    state.clear();
  } else {
    state.delete(stationId);
  }
}

/** Read-only snapshot of the current in-memory state (for tests). */
export function getSpinitronWebStateSnapshot(): ReadonlyMap<
  number,
  SpinitronWebStationState
> {
  return state;
}
