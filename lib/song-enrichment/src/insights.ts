import { config } from "./config.js";
import { logger } from "./logger.js";
import {
  seedTrackInsights,
  type SeedTrackInsights,
} from "./insights-seed.js";

/**
 * Live timestamped track insights (Task #39).
 *
 * As a record plays under turntable sync, this surfaces short, hand-curated
 * musical/production notes at the right moment — driven entirely off the
 * EXISTING turntable clock anchor. It reads the live computed position; it
 * never seeks and never touches the resolve/play/seek hot path. Everything is
 * config + data gated: with no curated seed entries the feature is a no-op, and
 * notes only ever come from the curated set (never fabricated).
 *
 * The timing logic (`selectDueInsights`) and the scheduler (`InsightScheduler`)
 * are pure/injectable so the "which note fires when" behavior is fully
 * unit-testable without real timers or a real Spotify clock.
 */

export interface TrackInsight {
  /** Offset into the recording (ms) where this note is due. */
  positionMs: number;
  /** The curated note to surface. */
  text: string;
}

function norm(s: string): string {
  return s.trim().toUpperCase();
}

/**
 * Build the lookup indexes from the seed once at module load. Two maps keyed by
 * the canonical id forms used elsewhere in the codebase: `isrc:<ISRC>` and
 * `mbrec:<recordingId>`. Each maps to the sorted insight list for that track.
 */
function indexSeed(seed: SeedTrackInsights[]): {
  byIsrc: Map<string, TrackInsight[]>;
  byRecordingId: Map<string, TrackInsight[]>;
  total: number;
} {
  const byIsrc = new Map<string, TrackInsight[]>();
  const byRecordingId = new Map<string, TrackInsight[]>();
  let total = 0;
  for (const entry of seed) {
    const insights = [...entry.insights].sort(
      (a, b) => a.positionMs - b.positionMs,
    );
    if (insights.length === 0) continue;
    total += insights.length;
    if (entry.isrc?.trim()) byIsrc.set(norm(entry.isrc), insights);
    if (entry.recordingId?.trim()) {
      byRecordingId.set(entry.recordingId.trim(), insights);
    }
  }
  return { byIsrc, byRecordingId, total };
}

const seedIndex = indexSeed(seedTrackInsights);

/** Whether any curated insights exist at all (the data gate). */
export function hasSeedData(): boolean {
  return seedIndex.total > 0;
}

/**
 * Feature gate: the master switch AND the presence of curated data. With no
 * seed entries the feature is a pure no-op regardless of the flag.
 */
export function insightsEnabled(): boolean {
  return config.TRACK_INSIGHTS_ENABLED && hasSeedData();
}

/**
 * Look up curated insights for a record by its canonical id(s). Merges the
 * MusicBrainz-recording-id and ISRC matches, de-duplicates by position+text,
 * and returns them sorted by position. Returns `[]` when nothing matches — so
 * a track with no curated notes naturally stays silent.
 */
export function getInsightsFor(ids: {
  isrc?: string | null;
  recordingId?: string | null;
}): TrackInsight[] {
  const merged: TrackInsight[] = [];
  if (ids.recordingId?.trim()) {
    const byRec = seedIndex.byRecordingId.get(ids.recordingId.trim());
    if (byRec) merged.push(...byRec);
  }
  if (ids.isrc?.trim()) {
    const byIsrc = seedIndex.byIsrc.get(norm(ids.isrc));
    if (byIsrc) merged.push(...byIsrc);
  }
  if (merged.length === 0) return [];
  const seen = new Set<string>();
  const out: TrackInsight[] = [];
  for (const ins of merged) {
    const key = `${ins.positionMs}|${ins.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ins);
  }
  out.sort((a, b) => a.positionMs - b.positionMs);
  return out;
}

/**
 * Pure selection: of `insights`, which are now due to fire? An insight is due
 * when its position is AT or after the arm baseline and at/under the current
 * position, and it hasn't fired yet for this play. The baseline is where we
 * tuned in: notes strictly before it are skipped as backfill (a moment the
 * record was already past), while a note exactly at the baseline is "right now"
 * and fires — this is what lets a 0:00 note fire on a track started from the
 * top, without ever surfacing earlier moments when we join mid-track. Sorted
 * earliest first. Fully pure — the heart of the timing behavior and the main
 * unit under test.
 */
export function selectDueInsights(
  insights: TrackInsight[],
  baselinePosMs: number,
  curPosMs: number,
  fired: ReadonlySet<number>,
): TrackInsight[] {
  return insights
    .filter(
      (ins) =>
        ins.positionMs >= baselinePosMs &&
        ins.positionMs <= curPosMs &&
        !fired.has(ins.positionMs),
    )
    .sort((a, b) => a.positionMs - b.positionMs);
}

/**
 * Drives curated insights against the live turntable clock. The session arms
 * it on each confirmed track with that track's insights and the position the
 * record was at when we tuned in (the baseline); `tick` then reads the live
 * position and fires at most one due note per `minGapMs`, deduping per play.
 *
 * Injection keeps it testable: `readPositionMs` returns the live clock
 * position (or null when the session isn't active), and `post` delivers a
 * note. No real timers or Spotify needed in tests — call `tick(nowMs)` with
 * scripted positions.
 */
export class InsightScheduler {
  private timer: NodeJS.Timeout | null = null;
  private armed = false;
  private insights: TrackInsight[] = [];
  private baselinePosMs = 0;
  private readonly fired = new Set<number>();
  // -Infinity so the first due note always fires regardless of the clock
  // origin; reset on every arm() so a new track never waits out the previous
  // track's throttle gap.
  private lastFireAtMs = Number.NEGATIVE_INFINITY;
  private readonly minGapMs: number;

  constructor(
    private readonly readPositionMs: () => number | null,
    private readonly post: (insight: TrackInsight) => void | Promise<void>,
    opts?: { minGapMs?: number },
  ) {
    this.minGapMs = Math.max(0, opts?.minGapMs ?? 0);
  }

  isArmed(): boolean {
    return this.armed;
  }

  /**
   * Load a track's curated insights and the baseline position (where the
   * record was when confirmed) so we never fire notes for moments already
   * passed. Resets the per-play fired set. A no-op load (empty insights)
   * simply leaves the scheduler disarmed.
   */
  arm(insights: TrackInsight[], baselinePosMs: number): void {
    this.fired.clear();
    this.lastFireAtMs = Number.NEGATIVE_INFINITY;
    if (insights.length === 0) {
      this.armed = false;
      this.insights = [];
      return;
    }
    this.armed = true;
    this.insights = [...insights].sort((a, b) => a.positionMs - b.positionMs);
    this.baselinePosMs = Math.max(0, baselinePosMs);
  }

  /** Clear armed state — e.g. when the session stops. */
  disarm(): void {
    this.armed = false;
    this.insights = [];
    this.fired.clear();
  }

  /**
   * One sampling step. Reads the live position, and if a curated note is due
   * (and the throttle gap has elapsed), fires the earliest one. Returns the
   * insights fired this tick (0 or 1) — handy for tests. Never throws from the
   * `post` callback (errors are logged and swallowed) so a delivery failure
   * can't break the timer.
   */
  tick(nowMs: number): TrackInsight[] {
    if (!this.armed) return [];
    const pos = this.readPositionMs();
    if (pos == null) {
      // Session no longer active / no clock — stand down until re-armed.
      this.disarm();
      return [];
    }
    if (nowMs - this.lastFireAtMs < this.minGapMs) return [];
    const due = selectDueInsights(
      this.insights,
      this.baselinePosMs,
      pos,
      this.fired,
    );
    const next = due[0];
    if (!next) return [];
    this.fired.add(next.positionMs);
    this.lastFireAtMs = nowMs;
    try {
      const r = this.post(next);
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch((err) =>
          logger.error("Insight post failed", { error: String(err) }),
        );
      }
    } catch (err) {
      logger.error("Insight post threw", { error: String(err) });
    }
    return [next];
  }

  /** Begin sampling the live clock on the configured interval. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.tick(Date.now()),
      config.TRACK_INSIGHTS_POLL_MS,
    );
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
