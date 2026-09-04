/**
 * Track expiry estimation — pure, no DB / network.
 *
 * A scan candidate near the end of its song is likely to change during the
 * landing handoff. When the recording's duration is known, estimate the
 * remaining play time and flag candidates inside a conservative
 * likely-expiring window so the landing flow expects a swap instead of
 * confidently labeling an about-to-expire track as current.
 *
 * Position sources, strongest first:
 *   1. Fingerprint play offset + capture time — ACRCloud's `play_offset_ms`
 *      is the position within the MATCHED ORIGINAL TRACK (not within the
 *      submitted clip; see AcrMatch.playOffsetMs), so
 *      elapsed = offset + (now − capturedAt). Fail-safe by construction: if a
 *      provider ever reported a clip-relative (near-zero) offset instead, the
 *      estimate would just say "plenty remaining" — advisory-only, so the
 *      worst case is a missing hint, never false churn.
 *   2. playedAt (station-reported or ingest-time start) — elapsed = now − playedAt.
 *
 * The estimate is ADVISORY ONLY: it never changes the displayed track. Only
 * real metadata updates (a genuinely new spin) do that. Absent duration ⇒
 * null estimate, no penalty.
 */
import { estimateTimingBoundary } from "./timing-evidence.js";

/** Remaining time below which a candidate is treated as likely to change. */
export const LIKELY_EXPIRING_THRESHOLD_MS = 15_000;

export interface ExpiryEstimate {
  /** Estimated remaining play time in ms, clamped to ≥ 0. */
  remainingMs: number;
  /** True when the track is inside the likely-expiring window (or past it). */
  likelyExpiring: boolean;
  /** Which position signal produced the estimate. */
  positionSource: "fingerprint" | "played_at";
  /** Bounded error inherited from the timing signal. */
  uncertaintyMs: number;
}

export interface ExpiryInputs {
  /** Recording duration in ms; null/undefined ⇒ no estimate. */
  durationMs: number | null | undefined;
  /** When the track started playing (station-reported or best guess). */
  playedAt: Date | null | undefined;
  /** ACR fingerprint play offset (ms into the song at capture time). */
  playOffsetMs?: number | null;
  /** End of the fingerprint clip; ACR's offset applies at this instant. */
  offsetCapturedAt?: Date | null;
  /** Explicit semantics for playedAt. Receipt-only timestamps are not starts. */
  timestampKind?: "source" | "fingerprint" | "inferred" | "receipt";
  /** Bounded start-time error. Null means no trustworthy estimate exists. */
  timingUncertaintyMs?: number | null;
  /** Clock override for tests; defaults to the current time. */
  now?: Date;
}

/**
 * Estimate remaining play time. Returns null when duration is unknown, when
 * no position signal exists, or when the inputs are nonsensical (elapsed
 * wildly exceeding duration — the spin is simply old, not "expiring").
 */
export function estimateExpiry(inputs: ExpiryInputs): ExpiryEstimate | null {
  const {
    durationMs,
    playedAt,
    playOffsetMs,
    offsetCapturedAt,
    timestampKind,
    timingUncertaintyMs,
  } = inputs;
  const now = inputs.now ?? new Date();
  if (durationMs == null || durationMs <= 0) return null;
  if (timestampKind === "receipt" || timingUncertaintyMs === null) return null;

  let elapsedMs: number | null = null;
  let positionSource: ExpiryEstimate["positionSource"] | null = null;

  // Fingerprint offset is the strongest position signal when both parts exist.
  if (
    playOffsetMs != null &&
    playOffsetMs >= 0 &&
    offsetCapturedAt instanceof Date &&
    !Number.isNaN(offsetCapturedAt.getTime())
  ) {
    const boundary = estimateTimingBoundary({
      durationMs,
      positionMs: playOffsetMs,
      observedAt: offsetCapturedAt,
      uncertaintyMs: timingUncertaintyMs,
      now,
    });
    if (boundary && now.getTime() >= offsetCapturedAt.getTime()) {
      elapsedMs = durationMs - (boundary.estimatedEndedAt.getTime() - now.getTime());
      positionSource = "fingerprint";
    }
  }

  if (elapsedMs == null) {
    if (timestampKind === "fingerprint") return null;
    if (!(playedAt instanceof Date) || Number.isNaN(playedAt.getTime())) return null;
    const boundary = estimateTimingBoundary({
      durationMs,
      positionMs: 0,
      observedAt: playedAt,
      uncertaintyMs: timingUncertaintyMs,
      now,
    });
    if (!boundary || now.getTime() < playedAt.getTime()) return null;
    elapsedMs = durationMs - (boundary.estimatedEndedAt.getTime() - now.getTime());
    positionSource = "played_at";
  }

  // A spin whose elapsed time wildly exceeds its duration isn't "about to
  // expire" — it's stale data (the poller missed the change, or playedAt is a
  // history-feed timestamp). Emitting likelyExpiring there would just add
  // churn; freshness classification already covers staleness.
  const OVERSHOOT_GRACE_MS = 60_000;
  if (elapsedMs > durationMs + OVERSHOOT_GRACE_MS) return null;

  const remainingMs = Math.max(0, durationMs - elapsedMs);
  return {
    remainingMs,
    likelyExpiring: remainingMs < LIKELY_EXPIRING_THRESHOLD_MS,
    positionSource: positionSource!,
    uncertaintyMs: Math.max(0, timingUncertaintyMs ?? 0),
  };
}
