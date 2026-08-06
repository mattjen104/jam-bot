/**
 * Pure utilities for computing track bar widths from `playedAt` deltas.
 *
 * Bar widths come from the gap between consecutive spins on the same station,
 * NOT from `duration_ms`.  Duration is 84.9% populated on recent MBID-resolved
 * spins but only 42.3% all-time, and KEXP — half the dataset — sits at 12%.
 * `playedAt` is 100% present by definition, works on KEXP, and is more honest:
 * it reflects what the station actually aired, not a recording's canonical length.
 *
 * The clamp prevents a polling gap from rendering as a six-hour "track".
 * Anything beyond the clamp renders as an explicit gap element, visually
 * distinct from a track bar, representing talk, ads, or a station ID.
 */

/**
 * Maximum bar width for a single spin's displayed duration.
 *
 * Chosen at 8 minutes: longer than any typical commercial song (longest common
 * airing ~7 min) but shorter than most ad breaks and talk segments (≥10 min).
 * A spin delta beyond this is almost certainly a polling gap, not a long track.
 */
export const MAX_BAR_MS = 8 * 60 * 1000; // 8 minutes

export interface SpinBarResult {
  /** Milliseconds to render as the track bar. Clamped to MAX_BAR_MS. */
  barMs: number;
  /**
   * Milliseconds to render as an explicit gap element (talk, ads, silence, or
   * a polling gap). 0 when the delta fits within the clamp.
   */
  gapMs: number;
}

/**
 * Computes the bar width (and any gap) for a spin, given the `playedAt`
 * of this spin and the next spin on the same station.
 *
 * Rules:
 * - Width comes from the `playedAt` delta. Duration is never used.
 * - The delta is clamped at MAX_BAR_MS. Excess renders as a gap.
 * - When `nextPlayedAt` is null (last spin in window), bar = MAX_BAR_MS, gap = 0.
 * - A delta ≤ 0 (clock skew, duplicates) returns { barMs: 0, gapMs: 0 }.
 *
 * Never estimates or interpolates. Never falls back to duration.
 */
export function computeSpinBarMs(
  playedAt: Date,
  nextPlayedAt: Date | null,
  clampMs: number = MAX_BAR_MS,
): SpinBarResult {
  if (!nextPlayedAt) {
    // Last spin in the visible window: give it the full clamp width, no gap.
    return { barMs: clampMs, gapMs: 0 };
  }
  const deltaMs = nextPlayedAt.getTime() - playedAt.getTime();
  if (deltaMs <= 0) return { barMs: 0, gapMs: 0 };
  if (deltaMs <= clampMs) return { barMs: deltaMs, gapMs: 0 };
  return { barMs: clampMs, gapMs: deltaMs - clampMs };
}

/**
 * Annotates a flat array of `{ playedAt }` objects (from one station) with
 * bar + gap widths.  Input must be sorted chronologically ascending.
 *
 * Returns a parallel array of SpinBarResult; index N corresponds to input[N].
 */
export function annotateSpinWidths<T extends { playedAt: string | Date }>(
  spins: T[],
  clampMs?: number,
): SpinBarResult[] {
  return spins.map((spin, i) => {
    const current = new Date(spin.playedAt);
    const next = i + 1 < spins.length ? new Date(spins[i + 1].playedAt) : null;
    return computeSpinBarMs(current, next, clampMs);
  });
}
