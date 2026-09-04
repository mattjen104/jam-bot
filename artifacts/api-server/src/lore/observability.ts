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
  stationsTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

type Snapshot = Record<string, unknown>;
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
export async function appendBoundaryPrediction(values: ImmutableEvidence & { predictedAt: Date; predictedBoundaryAt?: Date | null }) {
  await db.insert(boundaryPredictionsTable).values(safeValues(values)).onConflictDoNothing({ target: boundaryPredictionsTable.idempotencyKey });
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
  await db.insert(captureDecisionsTable).values(safeValues(values)).onConflictDoNothing({ target: captureDecisionsTable.idempotencyKey });
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