/**
 * Server-clock estimator for advisory broadcast timing.
 *
 * Samples use the request midpoint (NTP's basic offset estimate) while elapsed
 * time advances from performance.now(), so a wrong or adjusted device wall
 * clock cannot make a countdown jump. Slow samples are rejected. Long
 * suspension or disagreement between wall and monotonic elapsed time clears
 * the estimate until a fresh response arrives.
 */

export const CLOCK_SAMPLE_MAX_RTT_MS = 2_000;
export const CLOCK_RESET_GAP_MS = 60_000;
export const CLOCK_WALL_DRIFT_LIMIT_MS = 2_000;

export interface ClockMark {
  wallMs: number;
  monotonicMs: number;
}

export interface ClockSampleResult {
  accepted: boolean;
  uncertaintyMs: number | null;
}

export class BroadcastClockEstimator {
  private anchorServerMs: number | null = null;
  private anchorMonotonicMs: number | null = null;
  private sampleUncertaintyMs: number | null = null;
  private lastMark: ClockMark | null = null;

  constructor(
    private readonly wallNow: () => number = Date.now,
    private readonly monotonicNow: () => number = () => performance.now(),
  ) {}

  mark(): ClockMark {
    return { wallMs: this.wallNow(), monotonicMs: this.monotonicNow() };
  }

  addSample(
    serverTime: string | number,
    started: ClockMark,
    received: ClockMark,
  ): ClockSampleResult {
    const serverMs =
      typeof serverTime === "number" ? serverTime : Date.parse(serverTime);
    const rttMs = received.monotonicMs - started.monotonicMs;
    const wallElapsedMs = received.wallMs - started.wallMs;
    if (
      !Number.isFinite(serverMs) ||
      rttMs < 0 ||
      rttMs > CLOCK_SAMPLE_MAX_RTT_MS ||
      Math.abs(wallElapsedMs - rttMs) > CLOCK_WALL_DRIFT_LIMIT_MS
    ) {
      return { accepted: false, uncertaintyMs: this.sampleUncertaintyMs };
    }

    // The server timestamp is placed at the request midpoint. From there,
    // monotonic elapsed time is the only clock used for countdown progression.
    this.anchorServerMs = serverMs;
    this.anchorMonotonicMs = started.monotonicMs + rttMs / 2;
    this.sampleUncertaintyMs = Math.ceil(rttMs / 2);
    this.lastMark = received;
    return { accepted: true, uncertaintyMs: this.sampleUncertaintyMs };
  }

  now(): number | null {
    if (this.anchorServerMs == null || this.anchorMonotonicMs == null) return null;
    const current = this.mark();
    if (this.lastMark) {
      const monotonicElapsed = current.monotonicMs - this.lastMark.monotonicMs;
      const wallElapsed = current.wallMs - this.lastMark.wallMs;
      if (
        monotonicElapsed < 0 ||
        monotonicElapsed > CLOCK_RESET_GAP_MS ||
        Math.abs(wallElapsed - monotonicElapsed) > CLOCK_WALL_DRIFT_LIMIT_MS
      ) {
        this.reset();
        return null;
      }
    }
    this.lastMark = current;
    return this.anchorServerMs + (current.monotonicMs - this.anchorMonotonicMs);
  }

  uncertaintyMs(): number | null {
    return this.sampleUncertaintyMs;
  }

  reset(): void {
    this.anchorServerMs = null;
    this.anchorMonotonicMs = null;
    this.sampleUncertaintyMs = null;
    this.lastMark = null;
  }
}
