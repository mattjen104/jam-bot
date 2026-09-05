import {
  appendBoundaryPrediction,
  appendBroadcastTimelineEvent,
  appendIcyMetadataCandidate,
  claimLatestUnevaluatedBoundaryEvaluation,
} from "./observability.js";
import { classifyIcyStreamTitle } from "./icy.js";
import { normalizeTimingEvidence } from "./timing-evidence.js";
import type { NowPlayingRaw } from "./types.js";

const PRODUCER_VERSION = "task-582.timeline.v2";
const ESTIMATOR_VERSION = "timing-evidence.v1";
const ICY_CANDIDATE_BUCKET_MS = 15 * 60_000;

export type ListenerBroadcastAdvisoryKind = "dj_speaking" | "music_resuming";
export interface ListenerBroadcastAdvisory {
  kind: ListenerBroadcastAdvisoryKind;
  observedAt: string;
  expiresAt: string;
}

/** Speech evidence is deliberately brief and advisory, never track identity. */
export const LISTENER_BROADCAST_ADVISORY_TTL_MS = 90_000;

/**
 * Reduce private speech ledgers to a listener-safe state. No transcript,
 * inferred identity, classifier detail, or predicted track crosses this seam.
 */
export function deriveListenerBroadcastAdvisory(args: {
  capture?: { outcome: string; occurredAt: Date } | null;
  resumption?: { occurredAt: Date } | null;
  trackObservedAt?: Date | null;
  now?: Date;
}): ListenerBroadcastAdvisory | null {
  const now = args.now ?? new Date();
  const candidates: Array<{ kind: ListenerBroadcastAdvisoryKind; occurredAt: Date }> = [];
  if (
    args.capture &&
    (args.capture.outcome === "speech" || args.capture.outcome === "speech_over_music")
  ) {
    candidates.push({ kind: "dj_speaking", occurredAt: args.capture.occurredAt });
  }
  if (args.resumption) {
    candidates.push({ kind: "music_resuming", occurredAt: args.resumption.occurredAt });
  }
  const latest = candidates.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
  if (!latest) return null;
  const expiresAt = new Date(latest.occurredAt.getTime() + LISTENER_BROADCAST_ADVISORY_TTL_MS);
  if (expiresAt.getTime() <= now.getTime()) return null;
  if (
    args.trackObservedAt &&
    args.trackObservedAt.getTime() > latest.occurredAt.getTime()
  ) {
    return null;
  }
  return {
    kind: latest.kind,
    observedAt: latest.occurredAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function snapshot(value: Record<string, unknown>): Record<string, unknown> {
  // JSON round-tripping prevents later caller mutation from changing the
  // append-only evidence handed to the persistence layer.
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function wallAndMonotonic() {
  return {
    observedWallTime: new Date().toISOString(),
    observedMonotonicNs: process.hrtime.bigint().toString(),
  };
}

async function appendSafely(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    // Timeline evidence is observational; an unavailable ledger must never
    // prevent listener-facing spin ingestion.
    console.warn("[lore] timeline append failed", error);
  }
}

export function recordIcyMetadataObservation(args: {
  stationId: number;
  source: string;
  streamTitle: string | null;
  observedAt: Date;
  monotonicMs: number;
  transition?: {
    previousTitle: string | null;
    oldObservedAt: Date;
    oldMonotonicMs: number;
  };
}): void {
  const occurredAt = args.observedAt;
  const wall = wallAndMonotonic();
  const eventType = args.transition ? "icy_metadata_transition" : "icy_metadata_observation";
  const sourceEventId = args.transition
    ? `${args.transition.previousTitle ?? ""}:${args.streamTitle ?? ""}:${args.transition.oldObservedAt.toISOString()}:${occurredAt.toISOString()}`
    : `${args.streamTitle ?? ""}:${occurredAt.toISOString()}`;
  void appendSafely(() => appendBroadcastTimelineEvent({
    stationId: args.stationId,
    eventType,
    occurredAt,
    idempotencyKey: `timeline:icy:${args.stationId}:${eventType}:${sourceEventId}`,
    producerVersion: PRODUCER_VERSION,
    outcome: "observed",
    featureSnapshot: snapshot({
      streamTitle: args.streamTitle,
      observedAt: occurredAt.toISOString(),
      monotonicMs: args.monotonicMs,
      ...(args.transition ? {
        previousTitle: args.transition.previousTitle,
        oldObservedAt: args.transition.oldObservedAt.toISOString(),
        oldMonotonicMs: args.transition.oldMonotonicMs,
      } : {}),
      uncertaintyMs: args.transition
        ? Math.max(0, occurredAt.getTime() - args.transition.oldObservedAt.getTime())
        : null,
      estimatorVersion: ESTIMATOR_VERSION,
      ...wall,
    }),
    provenance: snapshot({ source: args.source, sourceEventId, transport: "icy" }),
  }));
}

export interface IcyMetadataCandidateRecord {
  rawStreamTitle: string;
  candidateClass: Exclude<
    ReturnType<typeof classifyIcyStreamTitle>["candidateClass"],
    "blank" | "track"
  >;
  rejectionReason: string;
  parsedArtist: string | null;
  parsedTitle: string | null;
  bucketStartedAt: Date;
}

export function buildIcyMetadataCandidate(
  streamTitle: string | null,
  observedAt: Date,
): IcyMetadataCandidateRecord | null {
  const classified = classifyIcyStreamTitle(streamTitle);
  if (
    !classified.raw ||
    classified.usable ||
    classified.candidateClass === "blank" ||
    classified.candidateClass === "track"
  ) {
    return null;
  }
  return {
    rawStreamTitle: classified.raw,
    candidateClass: classified.candidateClass,
    rejectionReason: classified.rejectionReason ?? "not_usable",
    parsedArtist: classified.artist,
    parsedTitle: classified.title,
    bucketStartedAt: new Date(
      Math.floor(observedAt.getTime() / ICY_CANDIDATE_BUCKET_MS) *
        ICY_CANDIDATE_BUCKET_MS,
    ),
  };
}

export function recordIcyMetadataCandidate(args: {
  stationId: number;
  source: string;
  streamTitle: string | null;
  observedAt: Date;
  transport: "watcher" | "poller";
}): void {
  const candidate = buildIcyMetadataCandidate(args.streamTitle, args.observedAt);
  if (!candidate) return;
  void appendSafely(() => appendIcyMetadataCandidate({
    stationId: args.stationId,
    source: args.source,
    rawStreamTitle: candidate.rawStreamTitle,
    observedAt: args.observedAt,
    bucketStartedAt: candidate.bucketStartedAt,
    candidateClass: candidate.candidateClass,
    rejectionReason: candidate.rejectionReason,
    parsedArtist: candidate.parsedArtist,
    parsedTitle: candidate.parsedTitle,
    provenance: snapshot({
      transport: args.transport,
      confirmedIdentity: false,
      retentionDays: 90,
      producerVersion: PRODUCER_VERSION,
    }),
  }));
}

/**
 * Persist timing signals only after a spin is confirmed. Predictions are
 * evidence, not identity: the normal spin dedup path never reads them.
 */
export function recordConfirmedSpinTimeline(args: {
  stationId: number;
  source: string;
  spinId: number | null;
  raw: NowPlayingRaw & { playedAt?: Date };
  confirmedAt?: Date;
  /** History/archive ingestion is never proof of a current live transition. */
  liveEvidence?: boolean;
}): void {
  const confirmedAt = args.confirmedAt ?? new Date();
  const wall = wallAndMonotonic();
  const raw = args.raw;
  const timing = normalizeTimingEvidence({
    durationMs: raw.durationMs,
    sourceStartedAt: raw.sourceStartedAt ?? raw.playedAt,
    sourceEndedAt: raw.sourceEndedAt,
    metadataObservedAt: raw.metadataObservedAt ?? confirmedAt,
    fingerprintOffsetMs: raw.playOffsetMs,
    captureEndedAt: raw.offsetCapturedAt,
    serverTime: confirmedAt,
  });
  const occurrenceAt = args.liveEvidence === false
    ? raw.playedAt ?? raw.sourceStartedAt ?? raw.sourceEndedAt ?? confirmedAt
    : raw.metadataObservedAt ?? raw.sourceStartedAt ?? raw.offsetCapturedAt ?? confirmedAt;
  const identityClock = raw.sourceStartedAt ?? raw.sourceEndedAt ??
    raw.metadataObservedAt ?? raw.offsetCapturedAt ?? raw.playedAt ?? confirmedAt;
  const identity = [
    args.source,
    raw.rawArtist,
    raw.rawTitle,
    identityClock.toISOString(),
  ].join("\u001f");
  const features = snapshot({
    spinId: args.spinId,
    artist: raw.rawArtist,
    title: raw.rawTitle,
    durationMs: raw.durationMs ?? null,
    timingBasis: timing.basis,
    timingConfidence: timing.confidence,
    estimatedAudibleStartedAt: timing.estimatedAudibleStartedAt?.toISOString() ?? null,
    estimatedEndedAt: timing.estimatedEndedAt?.toISOString() ?? null,
    fingerprintOffsetMs: raw.playOffsetMs ?? null,
    captureEndedAt: raw.offsetCapturedAt?.toISOString() ?? null,
    occurredAt: occurrenceAt.toISOString(),
    uncertaintyMs: raw.icyTransitionBracket
      ? Math.max(
          0,
          raw.icyTransitionBracket.newObservedAt.getTime() -
            raw.icyTransitionBracket.oldObservedAt.getTime(),
        )
      : timing.confidence === "trusted" ? 0 : null,
    icyTransitionBracket: raw.icyTransitionBracket
      ? {
          oldObservedAt: raw.icyTransitionBracket.oldObservedAt.toISOString(),
          newObservedAt: raw.icyTransitionBracket.newObservedAt.toISOString(),
          oldMonotonicMs: raw.icyTransitionBracket.oldMonotonicMs,
          newMonotonicMs: raw.icyTransitionBracket.newMonotonicMs,
        }
      : null,
    estimatorVersion: ESTIMATOR_VERSION,
    ...wall,
  });

  void appendSafely(async () => {
    // A history/backfill row can be confirmed long after it aired; it must
    // never consume a prediction for whichever track happens to be live now.
    // Approximate clocks likewise remain observational rather than wrong.
    const trustedLiveEvidence = args.liveEvidence !== false &&
      (
        (timing.confidence === "trusted" &&
          (timing.basis === "source_native" || timing.basis === "fingerprint")) ||
        raw.icyTransitionBracket != null
      );
    if (trustedLiveEvidence) {
      await claimLatestUnevaluatedBoundaryEvaluation({
        stationId: args.stationId,
        evaluatedAt: occurrenceAt,
        evidenceId: identity,
        producerVersion: PRODUCER_VERSION,
        outcome: raw.icyTransitionBracket
          ? "confirmed_icy_transition"
          : "confirmed_transition",
        featureSnapshot: features,
        provenance: snapshot({
          source: args.source,
          confirmation: "trusted_live_persisted_spin",
          timingBasis: raw.icyTransitionBracket ? "icy_transition" : timing.basis,
        }),
        errorForPrediction: (prediction) => prediction.predictedBoundaryAt
          ? occurrenceAt.getTime() - prediction.predictedBoundaryAt.getTime()
          : null,
      });
    }

    await appendBroadcastTimelineEvent({
      stationId: args.stationId,
      eventType: "confirmed_spin_transition",
      occurredAt: occurrenceAt,
      idempotencyKey: `timeline:spin:${args.stationId}:${identity}`,
      producerVersion: PRODUCER_VERSION,
      outcome: "confirmed",
      featureSnapshot: features,
      provenance: snapshot({ source: args.source, spinId: args.spinId }),
    });

    // Archive predictions describe already-finished programming and must not
    // become a future live claim candidate after a restart.
    if (!timing.estimatedEndedAt || args.liveEvidence === false) return;
    const idempotencyKey = `timeline:boundary:${args.stationId}:${identity}:${timing.estimatedEndedAt.toISOString()}`;
    await appendBoundaryPrediction({
      stationId: args.stationId,
      predictedAt: confirmedAt,
      predictedBoundaryAt: timing.estimatedEndedAt,
      idempotencyKey,
      producerVersion: PRODUCER_VERSION,
      outcome: timing.confidence,
      featureSnapshot: features,
      provenance: snapshot({ source: args.source, basis: timing.basis }),
    });
  });
}