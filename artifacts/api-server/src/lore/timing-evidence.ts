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

/**
 * An append-only account of the signals used to place a song on a station's
 * timeline.  These are deliberately domain types rather than database rows:
 * consumers may keep them in a log, send them across a queue, or recompute
 * them without giving an observation a mutable identity.
 */
export type TimingEvidenceEventType =
  | "source_timing"
  | "fingerprint_timing"
  | "metadata_observation"
  | "inferred_timing";

export interface TimingProvenance {
  basis: TimingBasis;
  /** System or provider which supplied the original signal. */
  source: string;
  /** Provider-specific immutable observation identifier, when supplied. */
  sourceEventId?: string | null;
}

export interface TimingFeatureSnapshot {
  durationMs?: number | null;
  artist?: string | null;
  title?: string | null;
  fingerprintOffsetMs?: number | null;
  [feature: string]: string | number | boolean | null | undefined;
}

export interface TimingVersionReferences {
  stationVersion?: string | null;
  parserVersion?: string | null;
  recognizerVersion?: string | null;
  modelVersion?: string | null;
  [reference: string]: string | null | undefined;
}

export interface TimingEvidenceEventInput {
  stationId: number | string;
  eventType: TimingEvidenceEventType;
  /** The time this signal was true at its source, not the log write time. */
  occurredAt: Date;
  /** Immutable, source-facing explanation of how this event was produced. */
  provenance: TimingProvenance;
  /** Error radius around an inferred boundary; null means unbounded. */
  uncertaintyMs: number | null;
  featureSnapshot?: TimingFeatureSnapshot;
  versionRefs?: TimingVersionReferences;
}

export interface TimingEvidenceEvent {
  readonly id: string;
  readonly stationId: number | string;
  readonly eventType: TimingEvidenceEventType;
  readonly occurredAt: Date;
  readonly provenance: Readonly<TimingProvenance>;
  readonly uncertaintyMs: number | null;
  readonly featureSnapshot: Readonly<TimingFeatureSnapshot>;
  readonly versionRefs: Readonly<TimingVersionReferences>;
}

function canonicalValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value == null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(",")}}`;
}

/** A small synchronous stable hash suitable for deterministic event IDs. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The ID is derived exclusively from station-scoped immutable evidence.  It
 * intentionally excludes receipt/server time, so retries generate the same
 * ID and cannot turn one observation into multiple timeline events.
 */
export function timingEvidenceEventId(input: TimingEvidenceEventInput): string {
  if (!validDate(input.occurredAt)) {
    throw new Error("Timing evidence event requires a valid occurredAt timestamp");
  }
  if (input.stationId === "" || input.stationId == null) {
    throw new Error("Timing evidence event requires a stationId");
  }
  const stableInput = {
    stationId: input.stationId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    provenance: input.provenance,
    uncertaintyMs: input.uncertaintyMs,
    featureSnapshot: input.featureSnapshot ?? {},
    versionRefs: input.versionRefs ?? {},
  };
  return `timing:${String(input.stationId)}:${stableHash(canonicalValue(stableInput))}`;
}

/** Construct a frozen event so downstream code cannot alter log evidence. */
export function createTimingEvidenceEvent(
  input: TimingEvidenceEventInput,
): TimingEvidenceEvent {
  if (
    input.uncertaintyMs !== null &&
    (!Number.isFinite(input.uncertaintyMs) || input.uncertaintyMs < 0)
  ) {
    throw new Error("Timing evidence uncertaintyMs must be a non-negative number or null");
  }
  const provenance = Object.freeze({ ...input.provenance });
  const featureSnapshot = Object.freeze({ ...(input.featureSnapshot ?? {}) });
  const versionRefs = Object.freeze({ ...(input.versionRefs ?? {}) });
  const occurredAtMs = input.occurredAt.getTime();
  const event = {
    id: timingEvidenceEventId(input),
    stationId: input.stationId,
    eventType: input.eventType,
    provenance,
    uncertaintyMs: input.uncertaintyMs,
    featureSnapshot,
    versionRefs,
  };
  // A frozen Date can still be changed with setTime. Expose a fresh Date on
  // every read so a consumer cannot mutate the event's historical timestamp.
  Object.defineProperty(event, "occurredAt", {
    enumerable: true,
    get: () => new Date(occurredAtMs),
  });
  return Object.freeze(event) as unknown as TimingEvidenceEvent;
}

export interface TimingBoundaryInputs {
  durationMs: number | null | undefined;
  /** Position in the recording at observedAt (zero is the audible start). */
  positionMs: number | null | undefined;
  observedAt: Date | null | undefined;
  uncertaintyMs?: number | null;
  now?: Date;
}

export interface TimingBoundaryEstimate {
  /** Best estimate of the recording's audible end. */
  estimatedEndedAt: Date;
  /** Earliest/latest plausible end given the supplied error radius. */
  earliestEndedAt: Date | null;
  latestEndedAt: Date | null;
  remainingMs: number;
  uncertaintyMs: number | null;
}

/**
 * Purely project a position observation onto a recording end boundary. This
 * is shared by all consumers so capture-end and start-clock arithmetic cannot
 * drift apart. Null uncertainty means a nominal boundary may be shown but
 * must not be used to make a certainty claim.
 */
export function estimateTimingBoundary(
  input: TimingBoundaryInputs,
): TimingBoundaryEstimate | null {
  if (
    !validDuration(input.durationMs) ||
    typeof input.positionMs !== "number" ||
    !Number.isFinite(input.positionMs) ||
    input.positionMs < 0 ||
    !validDate(input.observedAt)
  ) return null;
  const uncertaintyMs = input.uncertaintyMs ?? null;
  if (uncertaintyMs !== null && (!Number.isFinite(uncertaintyMs) || uncertaintyMs < 0)) {
    return null;
  }
  const estimatedEndedAt = new Date(
    input.observedAt.getTime() + input.durationMs - input.positionMs,
  );
  const now = validDate(input.now) ? input.now : new Date();
  return {
    estimatedEndedAt,
    earliestEndedAt: uncertaintyMs === null
      ? null : new Date(estimatedEndedAt.getTime() - uncertaintyMs),
    latestEndedAt: uncertaintyMs === null
      ? null : new Date(estimatedEndedAt.getTime() + uncertaintyMs),
    remainingMs: Math.max(0, estimatedEndedAt.getTime() - now.getTime()),
    uncertaintyMs,
  };
}

export interface DelayedBoundaryEvaluation {
  /** Whether a caller should wait and inspect a fresh observation. */
  shouldDelay: boolean;
  /** The first time a re-check can resolve this uncertainty window. */
  evaluateAt: Date | null;
  /** True only after the latest plausible end boundary has passed. */
  conclusivelyEnded: boolean;
}

/**
 * Evaluate a boundary without scheduling timers. In its uncertainty window a
 * caller gets a deterministic re-check time rather than prematurely treating
 * an advisory estimate as a track transition.
 */
export function evaluateDelayedBoundary(
  boundary: TimingBoundaryEstimate | null,
  now: Date = new Date(),
): DelayedBoundaryEvaluation {
  if (!boundary) return { shouldDelay: false, evaluateAt: null, conclusivelyEnded: false };
  const nowMs = now.getTime();
  if (boundary.latestEndedAt == null) {
    return {
      shouldDelay: false,
      evaluateAt: null,
      conclusivelyEnded: nowMs >= boundary.estimatedEndedAt.getTime(),
    };
  }
  const latestMs = boundary.latestEndedAt.getTime();
  return {
    shouldDelay: nowMs >= boundary.earliestEndedAt!.getTime() && nowMs < latestMs,
    evaluateAt: nowMs < latestMs ? new Date(latestMs) : null,
    conclusivelyEnded: nowMs >= latestMs,
  };
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
