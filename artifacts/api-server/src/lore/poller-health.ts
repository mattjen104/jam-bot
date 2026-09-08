import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const POLLER_HEARTBEAT_INTERVAL_MS = 60_000;
export const POLLER_STALE_THRESHOLD_MS = 3 * POLLER_HEARTBEAT_INTERVAL_MS;
// Slowest sources run every 15 minutes and boot staggering can span tens of
// minutes on a large roster. Forty-five minutes allows a full round without
// masking a genuinely wedged set of station workers.
export const POLLER_CYCLE_STALE_THRESHOLD_MS = 45 * 60_000;
const DEFAULT_HEALTH_KEY = "now-playing";
let healthKey = DEFAULT_HEALTH_KEY;

export type PollerRecoveryState = "healthy" | "recovering" | "stalled" | "stopped";

export type PollerFleetAlertKind = "poller_fleet_stalled" | "poller_fleet_recovered";
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
  healthKey: string;
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
  persistedRecoveryState: PollerRecoveryState;
  lastStallDetectedAt: Date | null;
  lastRecoveredAt: Date | null;
}

let runtime: RuntimeState | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

let alertTimer: NodeJS.Timeout | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();

export function pollerFleetAlertForTransition(
  previous: PollerRecoveryState,
  next: PollerRecoveryState,
): PollerFleetAlertKind | null {
  if (previous === "healthy" && next === "stalled") return "poller_fleet_stalled";
  if (previous === "stalled" && next === "healthy") return "poller_fleet_recovered";
  return null;
}
let ownershipGateForTests: Promise<void> | null = null;

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

async function readDurableRow(
  key: string = healthKey,
): Promise<DurablePollerHealthRow | null> {
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
    WHERE key = ${key}
  `);
  const row = result.rows[0] as
    | (Omit<
        DurablePollerHealthRow,
        | "processStartedAt"
        | "heartbeatAt"
        | "cycleStartedAt"
        | "lastCycleCompletedAt"
        | "lastStallDetectedAt"
        | "lastRecoveredAt"
      > & {
        processStartedAt: Date | string;
        heartbeatAt: Date | string;
        cycleStartedAt: Date | string;
        lastCycleCompletedAt: Date | string | null;
        lastStallDetectedAt: Date | string | null;
        lastRecoveredAt: Date | string | null;
      })
    | undefined;
  if (!row) return null;
  return {
    ...row,
    processStartedAt: new Date(row.processStartedAt),
    heartbeatAt: new Date(row.heartbeatAt),
    cycleStartedAt: new Date(row.cycleStartedAt),
    lastCycleCompletedAt: row.lastCycleCompletedAt
      ? new Date(row.lastCycleCompletedAt)
      : null,
    lastStallDetectedAt: row.lastStallDetectedAt
      ? new Date(row.lastStallDetectedAt)
      : null,
    lastRecoveredAt: row.lastRecoveredAt ? new Date(row.lastRecoveredAt) : null,
  };
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
  await ownershipGateForTests;
  await db.execute(sql`
    INSERT INTO lore_poller_health (
      key, owner_id, process_started_at, heartbeat_at, active,
      expected_station_count, enrolled_station_count, cycle_started_at,
      last_cycle_completed_at, attempted_station_count, successful_station_count,
      recovery_state, last_stall_detected_at, last_recovered_at, updated_at
    ) VALUES (
      ${state.healthKey}, ${state.ownerId}, ${state.processStartedAt}, ${state.heartbeatAt}, true,
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
    WHERE lore_poller_health.process_started_at <= EXCLUDED.process_started_at
  `);
}

async function persistHeartbeat(state: RuntimeState, now: Date): Promise<void> {
  if (runtime?.ownerId !== state.ownerId) return;
  const previousRecoveryState = state.persistedRecoveryState;
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
  const alertKind = pollerFleetAlertForTransition(previousRecoveryState, state.recoveryState);
  const incidentAt =
    alertKind === "poller_fleet_stalled" ? state.lastStallDetectedAt : state.lastRecoveredAt;
  const alertKey =
    alertKind && incidentAt
      ? `${state.healthKey}:${incidentAt.toISOString()}:${alertKind}`
      : null;
  const payload = alertKind
    ? JSON.stringify({
        kind: alertKind,
        occurredAt: now.toISOString(),
        expectedStationCount: state.expectedStationIds.size,
        enrolledStationCount: state.enrolledStationIds.size,
        lastCycleCompletedAt: state.lastCycleCompletedAt?.toISOString() ?? null,
      })
    : null;
  const persisted = await db.execute(sql`
    WITH persisted AS (
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
      WHERE key = ${state.healthKey} AND owner_id = ${state.ownerId}
      RETURNING owner_id
    ), enqueued AS (
      INSERT INTO lore_operator_alert_outbox (
        alert_key, owner_id, kind, occurred_at, payload
      )
      SELECT ${alertKey}, ${state.ownerId}, ${alertKind}, ${incidentAt}, ${payload}::jsonb
      FROM persisted
      WHERE ${alertKind} IS NOT NULL AND ${incidentAt} IS NOT NULL
      ON CONFLICT (alert_key) DO NOTHING
      RETURNING id
    )
    SELECT owner_id FROM persisted
  `);
  if (persisted.rowCount === 0) return;
  state.persistedRecoveryState = state.recoveryState;
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

export function flushPollerHeartbeatForTests(now: Date = new Date()): Promise<void> {
  return queueHeartbeat(now);
}
export async function startPollerHeartbeat(expectedStationIds: number[]): Promise<void> {
  const now = new Date();
  const key = healthKey;
  const previous = await readDurableRow(key).catch(() => null);
  const previousHealth = classifyPollerHeartbeat(previous, now);
  const recovering =
    previousHealth.stale || previous?.active === true || previous?.recoveryState === "stalled";

  runtime = {
    healthKey: key,
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
    persistedRecoveryState: recovering ? "recovering" : "healthy",
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
  alertTimer = setInterval(() => {
    if (runtime?.ownerId === runtimeState.ownerId) {
      void deliverPendingFleetAlert(runtimeState).catch(() => undefined);
    }
  }, POLLER_HEARTBEAT_INTERVAL_MS);
  alertTimer.unref?.();
  const runtimeState = runtime;
  void deliverPendingFleetAlert(runtimeState).catch(() => undefined);
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
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
  const state = runtime;
  runtime = null;
  if (!state) return;
  await persistenceQueue;
  await db.execute(sql`
    UPDATE lore_poller_health
    SET active = false, recovery_state = 'stopped', updated_at = now()
    WHERE key = ${state.healthKey} AND owner_id = ${state.ownerId}
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
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
  runtime = null;
  persistenceQueue = Promise.resolve();
  ownershipGateForTests = null;
  healthKey = DEFAULT_HEALTH_KEY;
}

export function setPollerHealthKeyForTests(key: string): void {
  if (runtime) throw new Error("Cannot change poller health key while heartbeat is active");
  healthKey = key;
}

export function setPollerOwnershipGateForTests(gate: Promise<void> | null): void {
  ownershipGateForTests = gate;
}

export function persistPollerHeartbeatForTests(now: Date = new Date()): Promise<void> {
  return queueHeartbeat(now);
}

async function deliverPendingFleetAlert(state: RuntimeState): Promise<void> {
  const webhookUrl = process.env.POLLER_ALERT_SLACK_WEBHOOK_URL;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID;
  if (!webhookUrl && !(botToken && channel)) return;
  const claimed = await db.execute(sql`
    UPDATE lore_operator_alert_outbox
    SET status = 'delivering', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id
      FROM lore_operator_alert_outbox
      WHERE (
        (status = 'pending' AND next_attempt_at <= now())
        OR (status = 'delivering' AND updated_at < now() - interval '15 minutes')
      )
      AND EXISTS (
        SELECT 1
        FROM lore_poller_health
        WHERE key = ${state.healthKey} AND owner_id = ${state.ownerId} AND active = true
      )
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, payload, attempts
  `);
  const row = claimed.rows[0] as
    | { id: number; kind: PollerFleetAlertKind; payload: Record<string, unknown>; attempts: number }
    | undefined;
  if (!row) return;
  const recovered = row.kind === "poller_fleet_recovered";
  const text = recovered
    ? `Resolved: Lore radio ingestion has recovered fleet-wide. ${row.payload["enrolledStationCount"] ?? 0}/${row.payload["expectedStationCount"] ?? 0} stations are enrolled.`
    : `Alert: Lore radio ingestion has stalled fleet-wide. ${row.payload["enrolledStationCount"] ?? 0}/${row.payload["expectedStationCount"] ?? 0} stations are enrolled.`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const usingWebhook = Boolean(webhookUrl);
    const response = await fetch(webhookUrl ?? "https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(usingWebhook ? {} : { authorization: `Bearer ${botToken}` }),
      },
      body: JSON.stringify(usingWebhook ? { text } : { channel, text }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) throw new Error(`webhook returned HTTP ${response.status}`);
    if (!usingWebhook) {
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!result.ok) throw new Error(`Slack API rejected alert: ${result.error ?? "unknown"}`);
    }
    await db.execute(sql`
      UPDATE lore_operator_alert_outbox
      SET status = 'delivered', delivered_at = now(), last_error = null, updated_at = now()
      WHERE id = ${row.id}
    `);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "unknown delivery error";
    const backoffMinutes = Math.min(60, 2 ** Math.min(row.attempts, 6));
    await db.execute(sql`
      UPDATE lore_operator_alert_outbox
      SET status = 'pending',
          next_attempt_at = now() + (${backoffMinutes} * interval '1 minute'),
          last_error = ${message},
          updated_at = now()
      WHERE id = ${row.id}
    `).catch(() => undefined);
  }
}
