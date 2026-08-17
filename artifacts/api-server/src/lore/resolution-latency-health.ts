/**
 * Tracks per-station now-playing resolution latency using a fixed-size in-memory
 * ring buffer. Each entry records the `source_to_resolved_ms` value captured in
 * `logSpinIfChanged` — i.e. the wall-clock time from when the source delivered
 * metadata to when the resolved `spin-changed` event left.
 *
 * The ring buffer holds the most recent RING_SIZE samples per station (default
 * 60, roughly one hour of normal music radio at ~1 track/minute). This gives a
 * rolling-hour view without unbounded memory growth.
 *
 * `getSlowResolutionStations()` returns stations whose rolling median exceeds
 * SLOW_THRESHOLD_MS (default 15 s), sorted worst-first. Ops can use this to
 * find stations where the source configuration (e.g. no ISRC, chronic MB
 * rate-limiting) is worth tuning.
 *
 * No external dependencies — all state is in-memory and does not survive
 * restarts (consistent with `feed-freshness-health.ts`).
 */

export const RING_SIZE = 60; // samples per station
export const SLOW_THRESHOLD_MS = 15_000; // 15 s median threshold

export interface ResolutionLatencyEntry {
  stationId: number;
  slug: string;
  /** Ring buffer of source_to_resolved_ms samples, oldest-first. */
  samples: number[];
  /** Index of the next write slot (modulo RING_SIZE). */
  head: number;
  /** How many samples have been recorded in total (capped at RING_SIZE). */
  count: number;
}

export interface SlowResolutionStation {
  stationId: number;
  slug: string;
  /** Number of samples in the ring buffer used for this report. */
  sampleCount: number;
  /** Rolling median source_to_resolved_ms across the ring buffer. */
  medianMs: number;
  /** 95th-percentile source_to_resolved_ms. */
  p95Ms: number;
  /** The maximum observed value in the buffer. */
  maxMs: number;
  /** True when medianMs exceeds SLOW_THRESHOLD_MS. */
  slow: boolean;
}

const state = new Map<number, ResolutionLatencyEntry>();

/**
 * Monotonically-increasing generation counter per station.  Every call to
 * `clearResolutionLatencyState(stationId)` bumps the generation so that
 * in-flight `logSpinIfChanged` work started before the unenrollment cannot
 * recreate the entry: a sample carrying a stale generation is silently dropped.
 *
 * The map is intentionally *not* cleared when an individual station entry is
 * cleared (only `clearResolutionLatencyState()` with no argument resets it) so
 * the generation survives the unenroll/re-enroll cycle.
 */
const generations = new Map<number, number>();

/**
 * The moment this module was first loaded — all counters were zero before
 * this instant, consistent with `feed-freshness-health.ts`.
 */
export const latencyMonitoringSince: Date = new Date();

/**
 * Capture the current generation for a station.  Call this at the very start
 * of a resolution attempt (inside `logSpinIfChangedInner`) and pass the
 * returned value to `recordResolutionLatency`.  If the station is unenrolled
 * before resolution completes, the generation will have changed and the sample
 * will be discarded.
 */
export function captureResolutionGeneration(stationId: number): number {
  return generations.get(stationId) ?? 0;
}

/**
 * Record one resolved-latency sample for a station.  The `generation` argument
 * must match the value returned by `captureResolutionGeneration` at the start
 * of the same resolution attempt; if it doesn't match (because the station was
 * unenrolled while resolution was in-flight) the sample is silently dropped.
 *
 * Called by `logSpinIfChangedInner` after the `spin-changed` event is emitted.
 */
export function recordResolutionLatency(
  stationId: number,
  slug: string,
  resolvedMs: number,
  generation: number,
): void {
  // Drop samples from work that started before the last unenrollment.
  const currentGen = generations.get(stationId) ?? 0;
  if (generation !== currentGen) return;

  let entry = state.get(stationId);
  if (!entry) {
    entry = {
      stationId,
      slug,
      samples: new Array<number>(RING_SIZE).fill(0),
      head: 0,
      count: 0,
    };
    state.set(stationId, entry);
  }
  entry.slug = slug; // keep fresh in case of a slug rename
  entry.samples[entry.head] = resolvedMs;
  entry.head = (entry.head + 1) % RING_SIZE;
  if (entry.count < RING_SIZE) entry.count++;
}

/** Compute the median of an array of numbers (must be non-empty). */
function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Compute the p-th percentile (0-100) of a sorted array (must be non-empty). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Return a summary for every tracked station, sorted by medianMs descending.
 * When `slowOnly` is true (default), only returns stations where the median
 * exceeds SLOW_THRESHOLD_MS.
 */
export function getSlowResolutionStations(slowOnly = true): SlowResolutionStation[] {
  const results: SlowResolutionStation[] = [];
  for (const entry of state.values()) {
    if (entry.count === 0) continue;
    const live = entry.samples.slice(0, entry.count).sort((a, b) => a - b);
    const medianMs = median(live);
    const p95Ms = percentile(live, 95);
    const maxMs = live[live.length - 1];
    const slow = medianMs > SLOW_THRESHOLD_MS;
    if (slowOnly && !slow) continue;
    results.push({
      stationId: entry.stationId,
      slug: entry.slug,
      sampleCount: entry.count,
      medianMs,
      p95Ms,
      maxMs,
      slow,
    });
  }
  return results.sort((a, b) => b.medianMs - a.medianMs);
}

/**
 * Return a per-station snapshot of all tracked entries (including fast ones).
 * Used by the admin endpoint to show the full picture.
 */
export function getAllResolutionLatencyStations(): SlowResolutionStation[] {
  return getSlowResolutionStations(false);
}

/**
 * Remove tracking state for a station (called on unenroll).
 * When `stationId` is omitted, clears all state (used in tests).
 *
 * Bumping the generation on per-station clears ensures that any in-flight
 * `logSpinIfChanged` work that captured the old generation before the unenroll
 * will have its sample silently dropped by `recordResolutionLatency`.
 */
export function clearResolutionLatencyState(stationId?: number): void {
  if (stationId === undefined) {
    state.clear();
    generations.clear();
  } else {
    state.delete(stationId);
    // Bump generation so in-flight samples from before this unenroll are dropped.
    generations.set(stationId, (generations.get(stationId) ?? 0) + 1);
  }
}

/** Read-only snapshot of the current in-memory state (for tests). */
export function getResolutionLatencyStateSnapshot(): ReadonlyMap<
  number,
  ResolutionLatencyEntry
> {
  return state;
}
