/**
 * Timestamp provenance for live now-playing data.
 *
 * `playedAt` remains the compatibility field used by the archive. The timing
 * contract below says what that value means for a live countdown. In
 * particular, receipt-only observations must never be mistaken for a track
 * start just because the database supplied a default timestamp.
 */

export type NowPlayingTimestampKind =
  | "source"
  | "fingerprint"
  | "inferred"
  | "receipt";

export type NowPlayingTimingReason =
  | "station_declared_start"
  | "fingerprint_play_offset"
  | "inferred_start"
  | "receipt_only";

export interface NowPlayingTiming {
  timestampKind: NowPlayingTimestampKind;
  timingReason: NowPlayingTimingReason;
  /** A bound on start-time error. Null means no useful bound is known. */
  timingUncertaintyMs: number | null;
  /** Only populated when the station itself declared the start. */
  sourceStartedAt: Date | null;
}

/** Conservative bounds for the signals currently available to Lore. */
export const SOURCE_START_UNCERTAINTY_MS = 5_000;
export const FINGERPRINT_UNCERTAINTY_MS = 3_000;
export const INFERRED_START_UNCERTAINTY_MS = 30_000;

export function timingConfidence(
  timing: Pick<NowPlayingTiming, "timestampKind" | "timingUncertaintyMs">,
): "trusted" | "estimated" | "unknown" {
  if (timing.timestampKind === "receipt" || timing.timingUncertaintyMs == null) {
    return "unknown";
  }
  if (
    (timing.timestampKind === "source" || timing.timestampKind === "fingerprint") &&
    timing.timingUncertaintyMs <= SOURCE_START_UNCERTAINTY_MS
  ) {
    return "trusted";
  }
  return "estimated";
}

export function timingFromRaw(raw: {
  playedAt?: Date;
  playOffsetMs?: number;
  offsetCapturedAt?: Date;
  timingKind?: NowPlayingTimestampKind;
}): NowPlayingTiming {
  if (
    raw.playOffsetMs != null &&
    raw.playOffsetMs >= 0 &&
    raw.offsetCapturedAt instanceof Date &&
    !Number.isNaN(raw.offsetCapturedAt.getTime())
  ) {
    return {
      timestampKind: "fingerprint",
      timingReason: "fingerprint_play_offset",
      timingUncertaintyMs: FINGERPRINT_UNCERTAINTY_MS,
      sourceStartedAt: null,
    };
  }

  if (raw.timingKind === "inferred") {
    return {
      timestampKind: "inferred",
      timingReason: "inferred_start",
      timingUncertaintyMs: INFERRED_START_UNCERTAINTY_MS,
      sourceStartedAt: null,
    };
  }

  if (raw.playedAt instanceof Date && !Number.isNaN(raw.playedAt.getTime())) {
    return {
      timestampKind: "source",
      timingReason: "station_declared_start",
      timingUncertaintyMs: SOURCE_START_UNCERTAINTY_MS,
      sourceStartedAt: raw.playedAt,
    };
  }

  return {
    timestampKind: "receipt",
    timingReason: "receipt_only",
    timingUncertaintyMs: null,
    sourceStartedAt: null,
  };
}

/** Timing for legacy rows written before the explicit contract existed. */
export function timingFromStoredRow(row: {
  timingKind?: string | null;
  timingReason?: string | null;
  timingUncertaintyMs?: number | null;
  sourceStartedAt?: Date | null;
  playedAt?: Date | null;
}): NowPlayingTiming {
  const kind = row.timingKind as NowPlayingTimestampKind | null | undefined;
  const reason = row.timingReason as NowPlayingTimingReason | null | undefined;
  if (
    (kind === "source" || kind === "fingerprint" || kind === "inferred" || kind === "receipt") &&
    (reason === "station_declared_start" ||
      reason === "fingerprint_play_offset" ||
      reason === "inferred_start" ||
      reason === "receipt_only")
  ) {
    return {
      timestampKind: kind,
      timingReason: reason,
      timingUncertaintyMs: row.timingUncertaintyMs ?? null,
      sourceStartedAt: row.sourceStartedAt ?? null,
    };
  }

  // Existing rows have a non-null played_at but no way to prove whether the
  // station supplied it. Treat them as inferred and visibly approximate.
  return {
    timestampKind: row.playedAt ? "inferred" : "receipt",
    timingReason: row.playedAt ? "inferred_start" : "receipt_only",
    timingUncertaintyMs: row.playedAt ? INFERRED_START_UNCERTAINTY_MS : null,
    sourceStartedAt: null,
  };
}
