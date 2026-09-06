import {
  db,
  broadcastTimelineEventsTable,
  boundaryPredictionsTable,
  boundaryEvaluationsTable,
  captureDecisionsTable,
  captureOutcomesTable,
  transcriptSegmentsTable,
  transcriptClaimsTable,
  scheduleComparisonsTable,
  operatorLabelsTable,
  icyMetadataCandidatesTable,
  stationsTable,
  stationSourceQualityTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { spinitronSourceCapabilities } from "./adapters.js";
import {
  compareIcyCandidateToSchedule,
  lookupActiveScheduleEntry,
} from "./speech-schedule-comparison.js";

type Snapshot = Record<string, unknown>;
const ICY_CANDIDATE_RETENTION_DAYS = 90;
const ICY_CANDIDATE_PRUNE_INTERVAL_MS = 6 * 60 * 60_000;
let nextIcyCandidatePruneAt = 0;
type ImmutableEvidence = {
  stationId?: number | null;
  idempotencyKey: string;
  producerVersion: string;
  outcome?: string;
  featureSnapshot: Snapshot;
  provenance: Snapshot;
};

export type ObservabilityKind =
  | "timeline" | "prediction" | "evaluation" | "capture-decision"
  | "capture-outcome" | "segment" | "claim" | "schedule-comparison" | "operator-label";

const tables = {
  timeline: broadcastTimelineEventsTable, prediction: boundaryPredictionsTable,
  evaluation: boundaryEvaluationsTable, "capture-decision": captureDecisionsTable,
  "capture-outcome": captureOutcomesTable, segment: transcriptSegmentsTable,
  claim: transcriptClaimsTable, "schedule-comparison": scheduleComparisonsTable,
  "operator-label": operatorLabelsTable,
} as const;

function safeValues<T extends ImmutableEvidence>(values: T): T {
  if (!values.idempotencyKey.trim() || !values.producerVersion.trim()) {
    throw new Error("idempotencyKey and producerVersion are required");
  }
  return values;
}

export async function appendBroadcastTimelineEvent(values: ImmutableEvidence & { eventType: string; occurredAt: Date }) {
  await db.insert(broadcastTimelineEventsTable).values(safeValues(values)).onConflictDoNothing({ target: broadcastTimelineEventsTable.idempotencyKey });
}

export async function appendIcyMetadataCandidate(values: {
  stationId: number;
  source: string;
  rawStreamTitle: string;
  observedAt: Date;
  bucketStartedAt: Date;
  candidateClass: string;
  rejectionReason: string;
  parsedArtist?: string | null;
  parsedTitle?: string | null;
  provenance: Snapshot;
}): Promise<void> {
  await db.insert(icyMetadataCandidatesTable).values(values).onConflictDoNothing({
    target: [
      icyMetadataCandidatesTable.stationId,
      icyMetadataCandidatesTable.source,
      icyMetadataCandidatesTable.rawStreamTitle,
      icyMetadataCandidatesTable.bucketStartedAt,
    ],
  });
  const now = Date.now();
  if (now >= nextIcyCandidatePruneAt) {
    nextIcyCandidatePruneAt = now + ICY_CANDIDATE_PRUNE_INTERVAL_MS;
    await db.delete(icyMetadataCandidatesTable).where(
      sql`${icyMetadataCandidatesTable.observedAt} < now() - (${ICY_CANDIDATE_RETENTION_DAYS} * interval '1 day')`,
    );
  }
}

export async function getIcyMetadataCandidateHealth(windowDays = 30) {
  const since = sql`now() - (${windowDays} * interval '1 day')`;
  const metrics = await db.execute<{
    candidate_class: string;
    stations: number;
    candidates: number;
    latest_observation: Date;
  }>(sql`
    SELECT candidate_class,
      count(DISTINCT station_id)::int AS stations,
      count(*)::int AS candidates,
      max(observed_at) AS latest_observation
    FROM ${icyMetadataCandidatesTable}
    WHERE observed_at >= ${since}
    GROUP BY candidate_class
    ORDER BY candidates DESC
  `);
  const recent = await db.select({
    stationId: icyMetadataCandidatesTable.stationId,
    stationName: stationsTable.name,
    source: icyMetadataCandidatesTable.source,
    rawStreamTitle: icyMetadataCandidatesTable.rawStreamTitle,
    observedAt: icyMetadataCandidatesTable.observedAt,
    candidateClass: icyMetadataCandidatesTable.candidateClass,
    rejectionReason: icyMetadataCandidatesTable.rejectionReason,
    stationTimezone: stationsTable.ianaTimezone,
  }).from(icyMetadataCandidatesTable)
    .innerJoin(stationsTable, eq(stationsTable.id, icyMetadataCandidatesTable.stationId))
    .where(sql`${icyMetadataCandidatesTable.observedAt} >= ${since}`)
    .orderBy(desc(icyMetadataCandidatesTable.observedAt))
    .limit(50);
  const recentWithSchedule = await Promise.all(recent.map(async (candidate) => {
    const schedule = await lookupActiveScheduleEntry(
      candidate.stationId,
      candidate.stationTimezone,
      candidate.observedAt,
    );
    const comparison = compareIcyCandidateToSchedule(
      candidate.rawStreamTitle,
      schedule,
    );
    const { stationTimezone: _stationTimezone, ...publicCandidate } = candidate;
    return {
      ...publicCandidate,
      scheduleCorroboration: comparison.outcome === "supporting"
        ? {
            ...comparison,
            showName: schedule!.showName,
            djName: schedule!.djName,
            sourceUrl: schedule!.sourceUrl,
            scheduleKind: schedule!.scheduleKind,
          }
        : comparison,
    };
  }));
  return { windowDays, metrics: metrics.rows, recent: recentWithSchedule };
}

export async function getSpinitronCapabilityHealth() {
  const rows = await db.select({
    stationId: stationsTable.id,
    stationSlug: stationsTable.slug,
    stationName: stationsTable.name,
    source: stationsTable.nowPlayingSource,
    config: stationsTable.nowPlayingConfig,
    scheduleAttemptedAt: stationsTable.scheduleAttemptedAt,
    scheduleFailureAt: stationsTable.scheduleFailureAt,
    scheduleFailureReason: stationsTable.scheduleFailureReason,
    sourceLastOutcome: stationSourceQualityTable.lastOutcome,
    sourceLastDetail: stationSourceQualityTable.lastDetail,
    sourceLastAttemptAt: stationSourceQualityTable.lastAttemptAt,
  }).from(stationsTable)
    .leftJoin(
      stationSourceQualityTable,
      and(
        eq(stationSourceQualityTable.stationId, stationsTable.id),
        eq(stationSourceQualityTable.source, stationsTable.nowPlayingSource),
      ),
    )
    .where(
      sql`${stationsTable.active} = true
        and ${stationsTable.nowPlayingSource} in ('spinitron', 'spinitron_web')`,
    )
    .orderBy(stationsTable.name);
  const attributionRows = rows.length
    ? await db.execute<{
        station_id: number;
        latest_spin_at: Date | null;
        latest_attribution_at: Date | null;
      }>(sql`
        SELECT target.id AS station_id,
          max(sp.observed_at) AS latest_spin_at,
          max(sp.observed_at) FILTER (
            WHERE sp.show_id IS NOT NULL
              AND sp.show_attribution_source IN ('source_api', 'schedule_match')
          ) AS latest_attribution_at
        FROM ${stationsTable} target
        LEFT JOIN spins sp
          ON sp.station_id = target.id
          AND sp.observed_at >= now() - interval '30 days'
        WHERE target.active = true
          AND target.now_playing_source IN ('spinitron', 'spinitron_web')
        GROUP BY target.id
      `)
    : { rows: [] };
  const attributionByStation = new Map(
    attributionRows.rows.map((row) => [row.station_id, row]),
  );
  const now = Date.now();
  const stations = rows.map(({ config, ...row }) => {
    const capabilities = spinitronSourceCapabilities(row.source, config);
    const evidence = attributionByStation.get(row.stationId);
    const latestAttributionAt = evidence?.latest_attribution_at ?? null;
    const latestSpinAt = evidence?.latest_spin_at ?? null;
    const staleAfterMs = row.source === "spinitron" ? 30 * 60_000 : 10 * 60_000;
    const scheduleFailure =
      row.scheduleFailureAt &&
      (!latestAttributionAt ||
        row.scheduleFailureAt.getTime() >
          new Date(latestAttributionAt).getTime())
        ? {
            at: row.scheduleFailureAt,
            reason: row.scheduleFailureReason ?? "unknown",
          }
        : null;
    const providerFailure =
      row.sourceLastOutcome === "response_error" &&
      row.sourceLastAttemptAt &&
      (!latestAttributionAt ||
        row.sourceLastAttemptAt.getTime() >
          new Date(latestAttributionAt).getTime())
        ? {
            at: row.sourceLastAttemptAt,
            reason: row.sourceLastDetail ?? "provider_response_error",
          }
        : null;
    const attributionFailure = providerFailure ?? scheduleFailure;
    const attributionStatus =
      attributionFailure
        ? "failed"
        : latestAttributionAt &&
            now - new Date(latestAttributionAt).getTime() <= staleAfterMs
          ? "healthy"
          : latestAttributionAt
            ? "stale"
            : latestSpinAt
              ? "not_produced"
              : capabilities?.authenticatedHistory
                ? "configured_no_evidence"
                : "public_only";
    return {
      ...row,
      capabilities,
      attribution: {
        status: attributionStatus,
        latestSpinAt,
        latestAttributionAt,
        staleAfterMs,
        lastAttemptAt: row.sourceLastAttemptAt,
        failure: attributionFailure,
      },
    };
  });
  return {
    stations,
    directoryCoverage: process.env["SPINITRON_API_KEY"]
      ? "authenticated"
      : "public_fallback",
    totals: {
      stations: stations.length,
      publicLiveMetadata: stations.filter(
        (row) => row.capabilities?.publicLiveMetadata,
      ).length,
      publicSchedule: stations.filter(
        (row) => row.capabilities?.publicSchedule,
      ).length,
      authenticatedHistory: stations.filter(
        (row) => row.capabilities?.authenticatedHistory,
      ).length,
      historyNotConfigured: stations.filter(
        (row) => row.capabilities?.historyStatus === "not_configured",
      ).length,
      healthyAttribution: stations.filter(
        (row) => row.attribution.status === "healthy",
      ).length,
      staleAttribution: stations.filter(
        (row) => row.attribution.status === "stale",
      ).length,
      failedAttribution: stations.filter(
        (row) => row.attribution.status === "failed",
      ).length,
      attributionNotProduced: stations.filter(
        (row) =>
          row.attribution.status === "not_produced" ||
          row.attribution.status === "configured_no_evidence",
      ).length,
      publicOnly: stations.filter(
        (row) => row.attribution.status === "public_only",
      ).length,
    },
  };
}
export async function appendBoundaryPrediction(values: ImmutableEvidence & { predictedAt: Date; predictedBoundaryAt?: Date | null }) {
  const inserted = await db.insert(boundaryPredictionsTable)
    .values(safeValues(values))
    .onConflictDoNothing({ target: boundaryPredictionsTable.idempotencyKey })
    .returning({ id: boundaryPredictionsTable.id });
  return inserted.length > 0;
}
export async function appendBoundaryEvaluation(values: ImmutableEvidence & { evaluatedAt: Date; predictionIdempotencyKey?: string | null; errorMs?: number | null }) {
  await db.insert(boundaryEvaluationsTable).values(safeValues(values)).onConflictDoNothing({ target: boundaryEvaluationsTable.idempotencyKey });
}

/**
 * Atomically consume the newest prediction which has not already been
 * evaluated.  The transaction advisory lock is station-scoped, so independent
 * API workers (and a process after restart) cannot both attach the same live
 * observation to a prediction.  Evaluations remain append-only: "claim" here
 * means inserting the immutable evaluation row, not mutating the prediction.
 */
export async function claimLatestUnevaluatedBoundaryEvaluation(args: Omit<ImmutableEvidence, "idempotencyKey"> & {
  stationId: number;
  evaluatedAt: Date;
  evidenceId: string;
  errorForPrediction: (prediction: {
    idempotencyKey: string;
    predictedBoundaryAt: Date | null;
  }) => number | null;
}): Promise<string | null> {
  const { evidenceId, errorForPrediction, ...evaluation } = args;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${args.stationId})`);
    const [prediction] = await tx.select({
      idempotencyKey: boundaryPredictionsTable.idempotencyKey,
      predictedBoundaryAt: boundaryPredictionsTable.predictedBoundaryAt,
    }).from(boundaryPredictionsTable)
      .leftJoin(
        boundaryEvaluationsTable,
        eq(
          boundaryEvaluationsTable.predictionIdempotencyKey,
          boundaryPredictionsTable.idempotencyKey,
        ),
      )
      .where(and(
        eq(boundaryPredictionsTable.stationId, args.stationId),
        isNull(boundaryEvaluationsTable.id),
      ))
      .orderBy(desc(boundaryPredictionsTable.predictedAt))
      .limit(1);
    if (!prediction) return null;
    await tx.insert(boundaryEvaluationsTable).values(safeValues({
      ...evaluation,
      predictionIdempotencyKey: prediction.idempotencyKey,
      errorMs: errorForPrediction(prediction),
      idempotencyKey: `timeline:evaluation:${args.stationId}:${prediction.idempotencyKey}:${evidenceId}`,
    })).onConflictDoNothing({
      target: boundaryEvaluationsTable.idempotencyKey,
    });
    return prediction.idempotencyKey;
  });
}
export async function appendCaptureDecision(values: ImmutableEvidence & { decidedAt: Date; decision: string }) {
  const inserted = await db.insert(captureDecisionsTable)
    .values(safeValues(values))
    .onConflictDoNothing({ target: captureDecisionsTable.idempotencyKey })
    .returning({ id: captureDecisionsTable.id });
  return inserted.length > 0;
}
export async function appendCaptureOutcome(values: ImmutableEvidence & { occurredAt: Date; decisionIdempotencyKey?: string | null }) {
  await db.insert(captureOutcomesTable).values(safeValues(values)).onConflictDoNothing({ target: captureOutcomesTable.idempotencyKey });
}
export async function appendTranscriptSegment(values: ImmutableEvidence & { capturedAt: Date }) {
  await db.insert(transcriptSegmentsTable).values(safeValues(values)).onConflictDoNothing({ target: transcriptSegmentsTable.idempotencyKey });
}
export async function appendTranscriptClaim(values: ImmutableEvidence & { claimedAt: Date; segmentIdempotencyKey?: string | null }) {
  await db.insert(transcriptClaimsTable).values(safeValues(values)).onConflictDoNothing({ target: transcriptClaimsTable.idempotencyKey });
}
export async function appendScheduleComparison(values: ImmutableEvidence & { comparedAt: Date }) {
  await db.insert(scheduleComparisonsTable).values(safeValues(values)).onConflictDoNothing({ target: scheduleComparisonsTable.idempotencyKey });
}
export async function appendOperatorLabel(values: ImmutableEvidence & { labeledAt: Date; label: string }) {
  await db.insert(operatorLabelsTable).values(safeValues(values)).onConflictDoNothing({ target: operatorLabelsTable.idempotencyKey });
}

/** Per station/version outcomes. Unknown is intentionally separate from failures. */
export async function getObservabilityHealth() {
  const union = Object.entries(tables).map(([kind, table]) =>
    sql`select ${kind}::text as kind, station_id, producer_version, outcome from ${table}`,
  );
  const rows = await db.execute<{
    kind: string; station_id: number | null; producer_version: string; outcome: string;
    total: number; unknown: number; failures: number;
  }>(sql`
    select e.kind, e.station_id, e.producer_version, count(*)::int as total,
      count(*) filter (where e.outcome = 'unknown')::int as unknown,
      count(*) filter (where e.outcome in ('failure', 'failed', 'error'))::int as failures
    from (${sql.join(union, sql` union all `)}) e
    group by e.kind, e.station_id, e.producer_version
    order by e.kind, e.station_id nulls first, e.producer_version
  `);
  return rows.rows;
}

export interface SpeechPilotThresholds {
  minimumSamples: number;
  minimumSpeechYield: number;
  minimumOverlapYield: number;
  minimumScheduleAgreement: number;
  maximumBoundaryErrorMs: number;
  maximumFailureRate: number;
}

export interface SpeechPilotMetrics {
  captures: number;
  speechCaptures: number;
  overlapCaptures: number;
  failedCaptures: number;
  scheduleSupporting: number;
  scheduleContradictory: number;
  boundaryEvaluations: number;
  speechYield: number | null;
  overlapYield: number | null;
  scheduleAgreement: number | null;
  meanBoundaryErrorMs: number | null;
  failureRate: number | null;
}

export interface SpeechPilotHealth {
  cohortStationIds: number[];
  windowHours: number;
  metrics: SpeechPilotMetrics;
  thresholds: SpeechPilotThresholds;
  sampleReady: boolean;
  healthy: boolean;
  regressions: string[];
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Cohort-scoped quality/resource gate used by both runtime admission and admin health. */
export async function getSpeechPilotHealth(
  cohortStationIds: readonly number[],
  thresholds: SpeechPilotThresholds,
  windowHours = 24,
): Promise<SpeechPilotHealth> {
  if (!cohortStationIds.length) {
    return {
      cohortStationIds: [], windowHours, thresholds, sampleReady: false, healthy: false,
      regressions: ["cohort_not_configured"],
      metrics: {
        captures: 0, speechCaptures: 0, overlapCaptures: 0, failedCaptures: 0,
        scheduleSupporting: 0, scheduleContradictory: 0, boundaryEvaluations: 0,
        speechYield: null, overlapYield: null, scheduleAgreement: null,
        meanBoundaryErrorMs: null, failureRate: null,
      },
    };
  }
  const stationIds = sql`ARRAY[${sql.join(cohortStationIds.map((id) => sql`${id}`), sql`, `)}]::integer[]`;
  const since = sql`now() - (${windowHours} * interval '1 hour')`;
  const result = await db.execute<{
    captures: number; speech_captures: number; overlap_captures: number; failed_captures: number;
    schedule_supporting: number; schedule_contradictory: number; boundary_evaluations: number;
    mean_boundary_error_ms: number | null;
  }>(sql`
    select
      (select count(*)::int from ${captureOutcomesTable}
        where station_id = any(${stationIds}) and occurred_at >= ${since}
          and producer_version like 'speech-shadow.%') as captures,
      (select count(*)::int from ${captureOutcomesTable}
        where station_id = any(${stationIds}) and occurred_at >= ${since}
          and producer_version like 'speech-shadow.%'
          and outcome in ('speech', 'speech_over_music')) as speech_captures,
      (select count(*)::int from ${captureOutcomesTable}
        where station_id = any(${stationIds}) and occurred_at >= ${since}
          and producer_version like 'speech-shadow.%'
          and outcome = 'speech_over_music') as overlap_captures,
      (select count(*)::int from ${captureOutcomesTable}
        where station_id = any(${stationIds}) and occurred_at >= ${since}
          and producer_version like 'speech-shadow.%'
          and (outcome like '%_failure' or outcome in ('capture_failure', 'unavailable', 'skipped'))) as failed_captures,
      (select count(*)::int from ${scheduleComparisonsTable}
        where station_id = any(${stationIds}) and compared_at >= ${since}
          and producer_version like 'speech-shadow.%' and outcome = 'supporting') as schedule_supporting,
      (select count(*)::int from ${scheduleComparisonsTable}
        where station_id = any(${stationIds}) and compared_at >= ${since}
          and producer_version like 'speech-shadow.%' and outcome = 'contradictory') as schedule_contradictory,
      (select count(error_ms)::int from ${boundaryEvaluationsTable}
        where station_id = any(${stationIds}) and evaluated_at >= ${since}) as boundary_evaluations,
      (select avg(abs(error_ms))::float from ${boundaryEvaluationsTable}
        where station_id = any(${stationIds}) and evaluated_at >= ${since}) as mean_boundary_error_ms
  `);
  const row = result.rows[0]!;
  const metrics: SpeechPilotMetrics = {
    captures: row.captures,
    speechCaptures: row.speech_captures,
    overlapCaptures: row.overlap_captures,
    failedCaptures: row.failed_captures,
    scheduleSupporting: row.schedule_supporting,
    scheduleContradictory: row.schedule_contradictory,
    boundaryEvaluations: row.boundary_evaluations,
    speechYield: ratio(row.speech_captures, row.captures),
    overlapYield: ratio(row.overlap_captures, row.speech_captures),
    scheduleAgreement: ratio(row.schedule_supporting, row.schedule_supporting + row.schedule_contradictory),
    meanBoundaryErrorMs: row.mean_boundary_error_ms,
    failureRate: ratio(row.failed_captures, row.captures),
  };
  const sampleReady = metrics.captures >= thresholds.minimumSamples;
  const regressions = sampleReady ? [
    metrics.speechYield != null && metrics.speechYield < thresholds.minimumSpeechYield ? "speech_yield" : null,
    metrics.overlapYield != null && metrics.overlapYield < thresholds.minimumOverlapYield ? "overlap_yield" : null,
    metrics.scheduleAgreement != null && metrics.scheduleAgreement < thresholds.minimumScheduleAgreement ? "schedule_agreement" : null,
    metrics.meanBoundaryErrorMs != null && metrics.meanBoundaryErrorMs > thresholds.maximumBoundaryErrorMs ? "boundary_error" : null,
    metrics.failureRate != null && metrics.failureRate > thresholds.maximumFailureRate ? "failure_rate" : null,
  ].filter((value): value is string => value != null) : [];
  return {
    cohortStationIds: [...cohortStationIds], windowHours, metrics, thresholds, sampleReady,
    healthy: !sampleReady || regressions.length === 0,
    regressions,
  };
}

export async function listObservabilityEvidence(kind: ObservabilityKind, limit = 100, stationId?: number) {
  const table = tables[kind];
  const rows = await db.select({
    id: table.id, stationId: table.stationId, stationSlug: stationsTable.slug,
    idempotencyKey: table.idempotencyKey, producerVersion: table.producerVersion,
    outcome: table.outcome, featureSnapshot: table.featureSnapshot,
    provenance: table.provenance, createdAt: table.createdAt,
  }).from(table).leftJoin(stationsTable, eq(table.stationId, stationsTable.id))
    .where(stationId == null ? undefined : eq(table.stationId, stationId))
    .orderBy(desc(table.createdAt)).limit(Math.min(Math.max(limit, 1), 250));
  return rows;
}