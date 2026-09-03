export type TimingConfidence = "trusted" | "approximate" | "unknown";
export type TimingBasis =
  | "source_native"
  | "fingerprint"
  | "inferred_start"
  | "metadata_observation"
  | "none";

export interface MetadataAudioLag {
  meanMs: number;
  standardDeviationMs: number;
  samples: number;
}

export interface TimingEvidenceInput {
  durationMs?: number | null;
  sourceStartedAt?: Date | null;
  sourceEndedAt?: Date | null;
  metadataObservedAt?: Date | null;
  inferredStartedAt?: Date | null;
  fingerprintOffsetMs?: number | null;
  captureStartedAt?: Date | null;
  captureEndedAt?: Date | null;
  captureMidpointAt?: Date | null;
  metadataAudioLag?: MetadataAudioLag | null;
  serverTime?: Date;
}

export interface NormalizedTimingEvidence {
  confidence: TimingConfidence;
  basis: TimingBasis;
  serverTime: Date;
  metadataObservedAt: Date | null;
  estimatedAudibleStartedAt: Date | null;
  estimatedEndedAt: Date | null;
  captureMidpointAt: Date | null;
  metadataAudioLagMs: number | null;
}

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validDuration(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function midpoint(
  explicit: Date | null | undefined,
  start: Date | null | undefined,
  end: Date | null | undefined,
): Date | null {
  if (validDate(explicit)) return explicit;
  if (!validDate(start) || !validDate(end) || end < start) return null;
  return new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
}

function usableLag(lag: MetadataAudioLag | null | undefined): number | null {
  if (
    !lag ||
    lag.samples < 3 ||
    !Number.isFinite(lag.meanMs) ||
    !Number.isFinite(lag.standardDeviationMs) ||
    lag.standardDeviationMs > 1_500 ||
    Math.abs(lag.meanMs) > 30_000
  ) {
    return null;
  }
  return lag.meanMs;
}

/**
 * Normalize unlike source clocks without conflating metadata arrival with an
 * audible boundary. ACR's play offset describes the position at the END of
 * the recognized clip, so fingerprint offsets are anchored to capture end.
 * The midpoint remains diagnostic evidence only. Identity-only recognition
 * has no offset and therefore cannot claim a position.
 */
export function normalizeTimingEvidence(
  input: TimingEvidenceInput,
): NormalizedTimingEvidence {
  const serverTime = input.serverTime ?? new Date();
  const metadataObservedAt = validDate(input.metadataObservedAt)
    ? input.metadataObservedAt
    : null;
  const captureMidpointAt = midpoint(
    input.captureMidpointAt,
    input.captureStartedAt,
    input.captureEndedAt,
  );
  const lagMs = usableLag(input.metadataAudioLag);

  if (validDate(input.sourceStartedAt) || validDate(input.sourceEndedAt)) {
    const startedAt = validDate(input.sourceStartedAt)
      ? input.sourceStartedAt
      : validDate(input.sourceEndedAt) && validDuration(input.durationMs)
        ? new Date(input.sourceEndedAt.getTime() - input.durationMs)
        : null;
    const endedAt = validDate(input.sourceEndedAt)
      ? input.sourceEndedAt
      : startedAt && validDuration(input.durationMs)
        ? new Date(startedAt.getTime() + input.durationMs)
        : null;
    return {
      confidence: "trusted",
      basis: "source_native",
      serverTime,
      metadataObservedAt,
      estimatedAudibleStartedAt: startedAt,
      estimatedEndedAt: endedAt,
      captureMidpointAt,
      metadataAudioLagMs: null,
    };
  }

  if (
    validDate(input.captureEndedAt) &&
    typeof input.fingerprintOffsetMs === "number" &&
    Number.isFinite(input.fingerprintOffsetMs) &&
    input.fingerprintOffsetMs >= 0
  ) {
    const startedAt = new Date(
      input.captureEndedAt.getTime() - input.fingerprintOffsetMs,
    );
    return {
      confidence: "trusted",
      basis: "fingerprint",
      serverTime,
      metadataObservedAt,
      estimatedAudibleStartedAt: startedAt,
      estimatedEndedAt: validDuration(input.durationMs)
        ? new Date(startedAt.getTime() + input.durationMs)
        : null,
      captureMidpointAt,
      metadataAudioLagMs: null,
    };
  }

  const inferredStartedAt = validDate(input.inferredStartedAt)
    ? input.inferredStartedAt
    : metadataObservedAt
      ? new Date(metadataObservedAt.getTime() + (lagMs ?? 0))
      : null;
  return {
    confidence: inferredStartedAt && validDuration(input.durationMs)
      ? "approximate"
      : "unknown",
    basis: validDate(input.inferredStartedAt)
      ? "inferred_start"
      : metadataObservedAt
        ? "metadata_observation"
        : "none",
    serverTime,
    metadataObservedAt,
    estimatedAudibleStartedAt: inferredStartedAt,
    estimatedEndedAt: inferredStartedAt && validDuration(input.durationMs)
      ? new Date(inferredStartedAt.getTime() + input.durationMs)
      : null,
    captureMidpointAt,
    metadataAudioLagMs: lagMs,
  };
}
