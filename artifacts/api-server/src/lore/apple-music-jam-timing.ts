export const JAM_JITTER_TOLERANCE_MS = 350;
export const JAM_CORRECTION_THRESHOLD_MS = 1_500;
export const JAM_MAX_CORRECTIONS = 3;

export type JamTransportState = "idle" | "playing" | "paused" | "ended";

export interface JamClockAnchor {
  positionMs: number;
  effectiveAtMs: number;
  state: JamTransportState;
}

/** Estimate a shared playhead without depending on a browser clock. */
export function positionAt(anchor: JamClockAnchor, serverNowMs: number): number {
  if (anchor.state !== "playing") return Math.max(0, anchor.positionMs);
  return Math.max(0, Math.round(anchor.positionMs + serverNowMs - anchor.effectiveAtMs));
}

export function driftMs(localPositionMs: number, targetPositionMs: number): number {
  return Math.round(targetPositionMs - localPositionMs);
}

export function shouldCorrect(drift: number): boolean {
  return Math.abs(drift) >= JAM_CORRECTION_THRESHOLD_MS;
}

export function correctionConverged(previous: number, next: number): boolean {
  return Math.abs(next) <= JAM_JITTER_TOLERANCE_MS || Math.abs(next) < Math.abs(previous);
}

export interface MatchStreakState {
  confirmedKey: string | null;
  candidateKey: string | null;
  candidateCount: number;
}

export interface FingerprintObservation {
  key: string;
  title: string;
  artist: string;
  isrc?: string;
  playOffsetMs: number;
  score?: number;
}

export type MatchDecision =
  | { kind: "miss" }
  | { kind: "low-confidence" }
  | { kind: "pending" }
  | { kind: "confirmed-current"; observation: FingerprintObservation }
  | { kind: "changed"; observation: FingerprintObservation };

/** Misses are no-ops; a new track needs two confident consecutive samples. */
export function observeMatch(
  state: MatchStreakState,
  observation: FingerprintObservation | null,
  minimumScore = 70,
): MatchDecision {
  if (!observation) return { kind: "miss" };
  if (observation.score != null && observation.score < minimumScore) {
    return { kind: "low-confidence" };
  }
  if (observation.key === state.confirmedKey) {
    state.candidateKey = null;
    state.candidateCount = 0;
    return { kind: "confirmed-current", observation };
  }
  if (state.candidateKey === observation.key) state.candidateCount += 1;
  else {
    state.candidateKey = observation.key;
    state.candidateCount = 1;
  }
  if (state.candidateCount < 2) return { kind: "pending" };
  state.confirmedKey = observation.key;
  state.candidateKey = null;
  state.candidateCount = 0;
  return { kind: "changed", observation };
}