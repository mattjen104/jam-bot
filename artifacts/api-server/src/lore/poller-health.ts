import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const POLLER_HEARTBEAT_INTERVAL_MS = 60_000;
export const POLLER_STALE_THRESHOLD_MS = 3 * POLLER_HEARTBEAT_INTERVAL_MS;
// Slowest sources run every 15 minutes and boot staggering can span tens of
// minutes on a large roster. Forty-five minutes allows a full round without
// masking a genuinely wedged set of station workers.
export const POLLER_CYCLE_STALE_THRESHOLD_MS = 45 * 60_000;
const HEALTH_KEY = "now-playing";

export type PollerRecoveryState = "healthy" | "recovering" | "stalled" | "stopped";

interface DurablePollerHealthRow {
  processStartedAt: Date;
  heartbeatAt: Date;
  active: boolean;
  expectedStationCount: number;
  enrolledStationCount: number;
  cycleStartedAt: Date;
  lastCycleCompletedAt: Date | null;
  attemptedStationCount: number;
  successfulStationCount: number;
  recoveryState: PollerRecoveryState;
  lastStallDetectedAt: Date | null;
  lastRecoveredAt: Date | null;
}

export interface PollerHealthSnapshot {
  active: boolean;
  stale: boolean;
  status: PollerRecoveryState;
  processStartedAt: Date | null;
  heartbeatAt: Date | null;
  heartbeatAgeMs: number | null;
  staleThresholdMs: number;
  cycleStaleThresholdMs: number;
  cycleAgeMs: number | null;
  expectedStationCount: number;
  enrolledStationCount: number;
  rosterComplete: boolean;
  cycleStartedAt: Date | null;
  lastCycleCompletedAt: Date | null;
  attemptedStationCount: number;
  successfulStationCount: number;
  currentAttemptedStationCount: number;
  currentSuccessfulStationCount: number;
  lastStallDetectedAt: Date | null;
  lastRecoveredAt: Date | null;
}

interface RuntimeState {
  ownerId: string;
  processStartedAt: Date;
  heartbeatAt: Date;
  expectedStationIds: Set<number>;
  enrolledStationIds: Set<number>;
  cycleStartedAt: Date;
  lastCycleCompletedAt: Date | null;
  attemptedStationCount: number;
  successfulStationCount: number;
  attempted: Set<number>;
  completed: Set<number>;
  successful: Set<number>;
  recoveryState: PollerRecoveryState;
  lastStallDetectedAt: Date | null;
  lastRecoveredAt: Date | null;
}

let runtime: RuntimeState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();

export function classifyPollerHeartbeat(
  row: Pick<
    DurablePollerHealthRow,
    | "active"
    | "heartbeatAt"
    | "recoveryState"
    | "cycleStartedAt"
    | "expectedStationCount"
    | "enrolledStationCount"
  > | null,
  now: Date = new Date(),
): {
  stale: boolean;
  status: PollerRecoveryState;
  heartbeatAgeMs: number | null;
  cycleAgeMs: number | null;
} {
  if (!row) {
    return {
      stale: true,
      status: "stopped",
      heartbeatAgeMs: null,
      cycleAgeMs: null,
    };
  }
  const heartbeatAgeMs = Math.max(0, now.getTime() - row.heartbeatAt.getTime());
  const cycleAgeMs = Math.max(0, now.getTime() - row.cycleStartedAt.getTime());
  const rosterIsComplete =
    row.expectedStationCount > 0 &&
    row.expectedStationCount === row.enrolledStationCount;
  const stale =
    row.active &&
    (heartbeatAgeMs >= POLLER_STALE_THRESHOLD_MS ||
      (rosterIsComplete && cycleAgeMs >= POLLER_CYCLE_STALE_THRESHOLD_MS));
  if (stale) {
    return { stale: true, status: "stalled", heartbeatAgeMs, cycleAgeMs };
  }
  if (!row.active) {
    return { stale: false, status: "stopped", heartbeatAgeMs, cycleAgeMs };
  }
  return {
    stale: false,
    status: row.recoveryState,
    heartbeatAgeMs,
    cycleAgeMs,
  };
}

async function readDurableRow(): Promise<DurablePollerHealthRow | null> {
  const result = await db.execute(sql`
    SELECT
      process_started_at AS "processStartedAt",
      heartbeat_at AS "heartbeatAt",
      active,
      expected_station_count AS "expectedStationCount",
      enrolled_station_count AS "enrolledStationCount",
      cycle_started_at AS "cycleStartedAt",
      last_cycle_completed_at AS "lastCycleCompletedAt",
      attempted_station_count AS "attemptedStationCount",
      successful_station_count AS "successfulStationCount",
      recovery_state AS "recoveryState",
      last_stall_detected_at AS "lastStallDetectedAt",
      last_recovered_at AS "lastRecoveredAt"
    FROM lore_poller_health
    WHERE key = ${HEALTH_KEY}
  `);
  return (result.rows[0] as unknown as DurablePollerHealthRow | undefined) ?? null;
}

function rosterComplete(state: RuntimeState): boolean {
  return (
    state.expectedStationIds.size > 0 &&
    state.enrolledStationIds.size === state.expectedStationIds.size &&
    [...state.expectedStationIds].every((id) => state.enrolledStationIds.has(id))
  );
}

function completeFleetCycleIfReady(now: Date = new Date()): void {
  if (!runtime || !rosterComplete(runtime)) return;
  if (![...runtime.enrolledStationIds].every((id) => runtime!.completed.has(id))) return;
  runtime.lastCycleCompletedAt = now;
  runtime.attemptedStationCount = runtime.attempted.size;
  runtime.successfulStationCount = runtime.successful.size;
  if (runtime.recoveryState === "stalled" && runtime.successful.size > 0) {
    runtime.recoveryState = "healthy";
    runtime.lastRecoveredAt = now;
  }
  runtime.cycleStartedAt = now;
  runtime.attempted.clear();
  runtime.completed.clear();
  runtime.successful.clear();
}

async function takeOwnership(state: RuntimeState): Promise<void> {
  await db.execute(sql`
    INSERT INTO lore_poller_health (
      key, owner_id, process_started_at, heartbeat_at, active,
      expected_station_count, enrolled_station_count, cycle_started_at,
      last_cycle_completed_at, attempted_station_count, successful_station_count,
      recovery_state, last_stall_detected_at, last_recovered_at, updated_at
    ) VALUES (
      ${HEALTH_KEY}, ${state.ownerId}, ${state.processStartedAt}, ${state.heartbeatAt}, true,
      ${state.expectedStationIds.size}, ${state.enrolledStationIds.size}, ${state.cycleStartedAt},
      ${state.lastCycleCompletedAt}, ${state.attemptedStationCount}, ${state.successfulStationCount},
      ${state.recoveryState}, ${state.lastStallDetectedAt}, ${state.lastRecoveredAt}, now()
    )
    ON CONFLICT (key) DO UPDATE SET
      owner_id = EXCLUDED.owner_id,
      process_started_at = EXCLUDED.process_started_at,
      heartbeat_at = EXCLUDED.heartbeat_at,
      active = true,
      expected_station_count = EXCLUDED.expected_station_count,
      enrolled_station_count = EXCLUDED.enrolled_station_count,
      cycle_started_at = EXCLUDED.cycle_started_at,
      last_cycle_completed_at = EXCLUDED.last_cycle_completed_at,
      attempted_station_count = EXCLUDED.attempted_station_count,
      successful_station_count = EXCLUDED.successful_station_count,
      recovery_state = EXCLUDED.recovery_state,
      last_stall_detected_at = EXCLUDED.last_stall_detected_at,
      last_recovered_at = EXCLUDED.last_recovered_at,
      updated_at = now()
  `);
}

async function persistHeartbeat(state: RuntimeState, now: Date): Promise<void> {
  if (runtime?.ownerId !== state.ownerId) return;
  state.heartbeatAt = now;
  const liveClassification = classifyPollerHeartbeat(
    {
      active: true,
      heartbeatAt: state.heartbeatAt,
      recoveryState: state.recoveryState,
      cycleStartedAt: state.cycleStartedAt,
      expectedStationCount: state.expectedStationIds.size,
      enrolledStationCount: state.enrolledStationIds.size,
    },
    now,
  );
  if (liveClassification.stale && state.recoveryState !== "stalled") {
    state.recoveryState = "stalled";
    state.lastStallDetectedAt = now;
  }
  if (
    state.recoveryState === "recovering" &&
    rosterComplete(state) &&
    (state.successful.size > 0 || state.successfulStationCount > 0)
  ) {
    state.recoveryState = "healthy";
    state.lastRecoveredAt = now;
  }
  await db.execute(sql`
    UPDATE lore_poller_health
    SET
      heartbeat_at = ${state.heartbeatAt},
      active = true,
      expected_station_count = ${state.expectedStationIds.size},
      enrolled_station_count = ${state.enrolledStationIds.size},
      cycle_started_at = ${state.cycleStartedAt},
      last_cycle_completed_at = ${state.lastCycleCompletedAt},
      attempted_station_count = ${state.attemptedStationCount},
      successful_station_count = ${state.successfulStationCount},
      recovery_state = ${state.recoveryState},
      last_stall_detected_at = ${state.lastStallDetectedAt},
      last_recovered_at = ${state.lastRecoveredAt},
      updated_at = now()
    WHERE key = ${HEALTH_KEY} AND owner_id = ${state.ownerId}
  `);
}

function queueHeartbeat(now: Date = new Date()): Promise<void> {
  const state = runtime;
  if (!state) return Promise.resolve();
  persistenceQueue = persistenceQueue
    .then(() => persistHeartbeat(state, now))
    .catch((error) => {
      console.error("[lore] failed to persist poller heartbeat", error);
    });
  return persistenceQueue;
}

export async function startPollerHeartbeat(expectedStationIds: number[]): Promise<void> {
  const now = new Date();
  const previous = await readDurableRow().catch(() => null);
  const previousHealth = classifyPollerHeartbeat(previous, now);
  const recovering =
    previousHealth.stale || previous?.active === true || previous?.recoveryState === "stalled";

  runtime = {
    ownerId: randomUUID(),
    processStartedAt: now,
    heartbeatAt: now,
    expectedStationIds: new Set(expectedStationIds),
    enrolledStationIds: new Set(),
    cycleStartedAt: now,
    lastCycleCompletedAt: previous?.lastCycleCompletedAt ?? null,
    attemptedStationCount: previous?.attemptedStationCount ?? 0,
    successfulStationCount: previous?.successfulStationCount ?? 0,
    attempted: new Set(),
    completed: new Set(),
    successful: new Set(),
    recoveryState: recovering ? "recovering" : "healthy",
    lastStallDetectedAt: previousHealth.stale
      ? now
      : previous?.lastStallDetectedAt ?? null,
    lastRecoveredAt: previous?.lastRecoveredAt ?? null,
  };
  await takeOwnership(runtime).catch((error) => {
    console.error("[lore] failed to persist initial poller heartbeat", error);
  });
  heartbeatTimer = setInterval(() => void queueHeartbeat(), POLLER_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
}

export function markPollerRosterEnrolled(stationIds: number[]): void {
  if (!runtime) return;
  runtime.enrolledStationIds = new Set(stationIds);
  completeFleetCycleIfReady();
}

export function registerPollerStation(stationId: number): void {
  if (!runtime) return;
  runtime.expectedStationIds.add(stationId);
  runtime.enrolledStationIds.add(stationId);
}

export function unregisterPollerStation(stationId: number): void {
  if (!runtime) return;
  runtime.expectedStationIds.delete(stationId);
  runtime.enrolledStationIds.delete(stationId);
  runtime.attempted.delete(stationId);
  runtime.completed.delete(stationId);
  runtime.successful.delete(stationId);
  completeFleetCycleIfReady();
}

export function recordPollerAttempt(stationId: number): void {
  if (!runtime || !runtime.enrolledStationIds.has(stationId)) return;
  runtime.attempted.add(stationId);
}

export function recordPollerCompletion(stationId: number, successful: boolean): void {
  if (!runtime || !runtime.enrolledStationIds.has(stationId)) return;
  runtime.attempted.add(stationId);
  runtime.completed.add(stationId);
  if (successful) runtime.successful.add(stationId);
  completeFleetCycleIfReady();
}

export async function stopPollerHeartbeat(): Promise<void> {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  const state = runtime;
  runtime = null;
  if (!state) return;
  await persistenceQueue;
  await db.execute(sql`
    UPDATE lore_poller_health
    SET active = false, recovery_state = 'stopped', updated_at = now()
    WHERE key = ${HEALTH_KEY} AND owner_id = ${state.ownerId}
  `).catch(() => undefined);
}

export async function getPollerHealth(now: Date = new Date()): Promise<PollerHealthSnapshot> {
  const row = runtime
    ? {
        processStartedAt: runtime.processStartedAt,
        heartbeatAt: runtime.heartbeatAt,
        active: true,
        expectedStationCount: runtime.expectedStationIds.size,
        enrolledStationCount: runtime.enrolledStationIds.size,
        cycleStartedAt: runtime.cycleStartedAt,
        lastCycleCompletedAt: runtime.lastCycleCompletedAt,
        attemptedStationCount: runtime.attemptedStationCount,
        successfulStationCount: runtime.successfulStationCount,
        recoveryState: runtime.recoveryState,
        lastStallDetectedAt: runtime.lastStallDetectedAt,
        lastRecoveredAt: runtime.lastRecoveredAt,
      }
    : await readDurableRow().catch(() => null);
  const classified = classifyPollerHeartbeat(row, now);
  return {
    active: row?.active ?? false,
    stale: classified.stale,
    status: classified.status,
    processStartedAt: row?.processStartedAt ?? null,
    heartbeatAt: row?.heartbeatAt ?? null,
    heartbeatAgeMs: classified.heartbeatAgeMs,
    staleThresholdMs: POLLER_STALE_THRESHOLD_MS,
    cycleStaleThresholdMs: POLLER_CYCLE_STALE_THRESHOLD_MS,
    cycleAgeMs: classified.cycleAgeMs,
    expectedStationCount: row?.expectedStationCount ?? 0,
    enrolledStationCount: row?.enrolledStationCount ?? 0,
    rosterComplete: runtime
      ? rosterComplete(runtime)
      : (row?.expectedStationCount ?? 0) > 0 &&
        row?.expectedStationCount === row?.enrolledStationCount,
    cycleStartedAt: row?.cycleStartedAt ?? null,
    lastCycleCompletedAt: row?.lastCycleCompletedAt ?? null,
    attemptedStationCount: row?.attemptedStationCount ?? 0,
    successfulStationCount: row?.successfulStationCount ?? 0,
    currentAttemptedStationCount: runtime?.attempted.size ?? 0,
    currentSuccessfulStationCount: runtime?.successful.size ?? 0,
    lastStallDetectedAt: row?.lastStallDetectedAt ?? null,
    lastRecoveredAt: row?.lastRecoveredAt ?? null,
  };
}

export function clearPollerHealthForTests(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  runtime = null;
  persistenceQueue = Promise.resolve();
}