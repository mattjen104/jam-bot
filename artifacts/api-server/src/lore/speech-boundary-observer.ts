import {
  db,
  scheduleComparisonsTable,
  stationsTable,
  type Station,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  appendBoundaryPrediction,
  appendCaptureDecision,
  appendCaptureOutcome,
} from "./observability.js";
import {
  parseSpeechPilotCohort,
  scheduleSpeechTransitionCandidate,
  speechShadowEnabled,
  type SpeechCandidateContext,
} from "./speech-shadow-orchestrator.js";
import {
  lookupActiveScheduleEntry,
  type ActiveScheduleEntry,
} from "./speech-schedule-comparison.js";

const PRODUCER_VERSION = "speech-schedule-boundary.v1";
const seenBoundaries = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

export interface ScheduledBoundaryCandidate {
  station: Station;
  boundaryAt: Date;
  previous: ActiveScheduleEntry | null;
  current: ActiveScheduleEntry;
  key: string;
}

export interface BoundaryEvidenceCounts {
  supporting: number;
  contradictory: number;
}

function integerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function scheduleIdentity(entry: ActiveScheduleEntry | null): string {
  if (!entry) return "";
  return [
    entry.scheduleKind,
    entry.showName.trim().toLocaleLowerCase(),
    entry.djName?.trim().toLocaleLowerCase() ?? "",
  ].join("|");
}

function minuteFloor(at: Date): Date {
  const value = new Date(at);
  value.setUTCSeconds(0, 0);
  return value;
}

export async function detectScheduledBoundary(
  station: Station,
  at: Date,
  lookup = lookupActiveScheduleEntry,
  lookbackMs = 75_000,
): Promise<ScheduledBoundaryCandidate | null> {
  if (!station.ianaTimezone) return null;
  const [previous, current] = await Promise.all([
    lookup(station.id, station.ianaTimezone, new Date(at.getTime() - lookbackMs)),
    lookup(station.id, station.ianaTimezone, at),
  ]);
  if (!current || scheduleIdentity(previous) === scheduleIdentity(current)) return null;
  const boundaryAt = minuteFloor(at);
  const key = [
    station.id,
    boundaryAt.toISOString(),
    scheduleIdentity(current),
  ].join(":");
  return { station, boundaryAt, previous, current, key };
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Contradictions and low-evidence schedules are always observed. Repeatedly
 * confirmed stations retain a deterministic sparse sample so drift can still
 * be found without paying for every weekly occurrence.
 */
export function shouldObserveScheduledBoundary(
  key: string,
  evidence: BoundaryEvidenceCounts,
  stableSampleEvery = 4,
): boolean {
  if (evidence.contradictory > 0 || evidence.supporting < 3) return true;
  return stableHash(key) % Math.max(1, stableSampleEvery) === 0;
}

async function listEligibleStations(cohort: readonly number[]): Promise<Station[]> {
  if (cohort.length === 0) return [];
  return db.select().from(stationsTable).where(and(
    inArray(stationsTable.id, cohort),
    eq(stationsTable.active, true),
    eq(stationsTable.hidden, false),
  ));
}

async function getBoundaryEvidenceCounts(
  stationId: number,
  showName: string,
  since: Date,
): Promise<BoundaryEvidenceCounts> {
  const [row] = await db.select({
    supporting: sql<number>`count(*) filter (where ${scheduleComparisonsTable.outcome} = 'supporting')::int`,
    contradictory: sql<number>`count(*) filter (where ${scheduleComparisonsTable.outcome} = 'contradictory')::int`,
  }).from(scheduleComparisonsTable).where(and(
    eq(scheduleComparisonsTable.stationId, stationId),
    gte(scheduleComparisonsTable.comparedAt, since),
    sql`${scheduleComparisonsTable.featureSnapshot} #>> '{scheduled,showName}' = ${showName}`,
  ));
  return {
    supporting: Number(row?.supporting ?? 0),
    contradictory: Number(row?.contradictory ?? 0),
  };
}

function candidateContext(candidate: ScheduledBoundaryCandidate): SpeechCandidateContext {
  return {
    kind: "scheduled_boundary",
    boundaryKey: candidate.key,
    boundaryAt: candidate.boundaryAt.toISOString(),
    scheduledShowName: candidate.current.showName,
    scheduledDjName: candidate.current.djName,
    scheduleSourceUrl: candidate.current.sourceUrl,
    scheduleKind: candidate.current.scheduleKind,
    previousShowName: candidate.previous?.showName ?? null,
    previousDjName: candidate.previous?.djName ?? null,
  };
}

interface PendingBoundary {
  station: Station;
  context: SpeechCandidateContext;
  predictionKey: string;
}

async function listPendingBoundaries(
  stations: readonly Station[],
  at: Date,
): Promise<PendingBoundary[]> {
  if (stations.length === 0) return [];
  const stationById = new Map(stations.map((station) => [station.id, station]));
  const ids = stations.map((station) => sql`${station.id}`);
  const pending = await db.execute<{
    stationId: number;
    predictionKey: string;
    context: unknown;
  }>(sql`
    SELECT bp.station_id AS "stationId",
      bp.idempotency_key AS "predictionKey",
      bp.feature_snapshot AS context
    FROM boundary_predictions bp
    WHERE bp.producer_version = ${PRODUCER_VERSION}
      AND bp.predicted_at >= ${new Date(at.getTime() - 20 * 60_000).toISOString()}::timestamptz
      AND bp.station_id IN (${sql.join(ids, sql`, `)})
      AND NOT EXISTS (
        SELECT 1
        FROM capture_outcomes co
        WHERE co.station_id = bp.station_id
          AND co.feature_snapshot #>> '{candidate,boundaryKey}'
            = bp.feature_snapshot #>> '{boundaryKey}'
      )
    ORDER BY bp.predicted_at
    LIMIT ${integerEnv("LORE_SPEECH_SCHEDULE_PENDING_LIMIT", 10)}
  `);
  return pending.rows.flatMap((row) => {
    const station = stationById.get(row.stationId);
    const context = row.context;
    if (!station || !context || typeof context !== "object" ||
      (context as { kind?: unknown }).kind !== "scheduled_boundary" ||
      typeof (context as { boundaryKey?: unknown }).boundaryKey !== "string") return [];
    return [{
      station,
      context: context as SpeechCandidateContext,
      predictionKey: row.predictionKey,
    }];
  });
}

async function processPendingBoundaries(
  stations: readonly Station[],
  at: Date,
  maxPerTick: number,
): Promise<number> {
  const pending = await listPendingBoundaries(stations, at);
  let admitted = 0;
  for (const item of pending) {
    if (admitted >= maxPerTick) break;
    const boundaryKey = String(item.context.boundaryKey);
    const showName = typeof item.context.scheduledShowName === "string"
      ? item.context.scheduledShowName
      : "";
    try {
      const evidence = await getBoundaryEvidenceCounts(
        item.station.id,
        showName,
        new Date(at.getTime() - integerEnv("LORE_SPEECH_SCHEDULE_EVIDENCE_DAYS", 30) * 86_400_000),
      );
      if (!shouldObserveScheduledBoundary(
        boundaryKey,
        evidence,
        integerEnv("LORE_SPEECH_SCHEDULE_STABLE_SAMPLE_EVERY", 4),
      )) {
        const decisionKey = `speech-schedule:stable-skip:${boundaryKey}`;
        const claimed = await appendCaptureDecision({
          stationId: item.station.id,
          decidedAt: at,
          decision: "skipped",
          idempotencyKey: decisionKey,
          producerVersion: PRODUCER_VERSION,
          outcome: "stable_sample_skipped",
          featureSnapshot: { candidate: item.context },
          provenance: { policy: "adaptive_per_show.v1", predictionKey: item.predictionKey },
        });
        await appendCaptureOutcome({
          stationId: item.station.id,
          occurredAt: at,
          decisionIdempotencyKey: decisionKey,
          idempotencyKey: `speech-schedule:stable-outcome:${boundaryKey}`,
          producerVersion: PRODUCER_VERSION,
          outcome: "stable_sample_skipped",
          featureSnapshot: { candidate: item.context },
          provenance: {
            policy: "adaptive_per_show.v1",
            predictionKey: item.predictionKey,
            decisionInserted: claimed,
          },
        });
        continue;
      }
      admitted += 1;
      void scheduleSpeechTransitionCandidate(item.station, undefined, undefined, item.context);
    } catch (error) {
      console.warn("[speech-boundary] pending candidate failed", {
        stationId: item.station.id,
        boundaryKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return admitted;
}

export async function runScheduledSpeechBoundaryTick(at = new Date()): Promise<number> {
  if (!speechShadowEnabled() || process.env["LORE_SPEECH_SCHEDULE_BOUNDARIES_ENABLED"] !== "true") return 0;
  const cohort = parseSpeechPilotCohort(process.env["LORE_SPEECH_PILOT_STATION_IDS"]);
  const stations = await listEligibleStations(cohort);
  const candidates = (await Promise.all(
    stations.map((station) => detectScheduledBoundary(station, at)),
  )).filter((candidate): candidate is ScheduledBoundaryCandidate => candidate !== null);

  const expiry = at.getTime() - 48 * 60 * 60_000;
  for (const [key, seenAt] of seenBoundaries) {
    if (seenAt < expiry) seenBoundaries.delete(key);
  }

  const maxPerTick = integerEnv("LORE_SPEECH_SCHEDULE_MAX_PER_TICK", 2);
  for (const candidate of candidates) {
    if (seenBoundaries.has(candidate.key)) continue;
    try {
      // This immutable insert doubles as a cross-process admission claim.
      // Only the process which created the prediction may spend capture budget.
      const claimed = await appendBoundaryPrediction({
        stationId: candidate.station.id,
        predictedAt: at,
        predictedBoundaryAt: candidate.boundaryAt,
        idempotencyKey: `speech-schedule:prediction:${candidate.key}`,
        producerVersion: PRODUCER_VERSION,
        outcome: "scheduled_boundary",
        featureSnapshot: candidateContext(candidate),
        provenance: {
          source: candidate.current.scheduleKind,
          sourceUrl: candidate.current.sourceUrl,
          extraction: candidate.current.extraction,
          scheduleReadOnly: true,
          observer: "post_boundary",
        },
      });
      seenBoundaries.set(candidate.key, at.getTime());
      if (!claimed) continue;
    } catch (error) {
      // One broken station or transient evidence write must not suppress other
      // due boundaries. The failed key is intentionally not marked as seen.
      console.warn("[speech-boundary] candidate failed", {
        stationId: candidate.station.id,
        boundaryKey: candidate.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return processPendingBoundaries(stations, at, maxPerTick);
}

export function startScheduledSpeechBoundaryObserver(): boolean {
  if (timer || !speechShadowEnabled() ||
    process.env["LORE_SPEECH_SCHEDULE_BOUNDARIES_ENABLED"] !== "true") return false;
  const tick = () => {
    if (tickInFlight) return;
    tickInFlight = true;
    void runScheduledSpeechBoundaryTick()
      .catch((error) => console.warn("[speech-boundary] tick failed", error))
      .finally(() => { tickInFlight = false; });
  };
  timer = setInterval(tick, integerEnv("LORE_SPEECH_SCHEDULE_TICK_MS", 60_000));
  timer.unref();
  tick();
  return true;
}

export function stopScheduledSpeechBoundaryObserver(): void {
  if (timer) clearInterval(timer);
  timer = null;
  tickInFlight = false;
  seenBoundaries.clear();
}