import {
  broadcastTimelineEventsTable,
  captureOutcomesTable,
  db,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import {
  deriveListenerBroadcastAdvisory,
  LISTENER_BROADCAST_ADVISORY_TTL_MS,
  type ListenerBroadcastAdvisory,
} from "./broadcast-timeline.js";

export function _testOnly_listenerCaptureQuery(stationIds: readonly number[], cutoff: Date) {
  return db.selectDistinctOn([captureOutcomesTable.stationId], {
    stationId: captureOutcomesTable.stationId,
    outcome: captureOutcomesTable.outcome,
    occurredAt: captureOutcomesTable.occurredAt,
  }).from(captureOutcomesTable)
    .where(and(
      inArray(captureOutcomesTable.stationId, [...stationIds]),
      or(
        eq(captureOutcomesTable.outcome, "speech"),
        eq(captureOutcomesTable.outcome, "speech_over_music"),
      ),
      gte(captureOutcomesTable.occurredAt, cutoff),
    ))
    .orderBy(captureOutcomesTable.stationId, desc(captureOutcomesTable.occurredAt));
}

export function _testOnly_listenerResumptionQuery(stationIds: readonly number[], cutoff: Date) {
  return db.selectDistinctOn([broadcastTimelineEventsTable.stationId], {
    stationId: broadcastTimelineEventsTable.stationId,
    occurredAt: broadcastTimelineEventsTable.occurredAt,
  }).from(broadcastTimelineEventsTable)
    .where(and(
      inArray(broadcastTimelineEventsTable.stationId, [...stationIds]),
      eq(broadcastTimelineEventsTable.eventType, "speech_ends_then_sustained_music"),
      gte(broadcastTimelineEventsTable.occurredAt, cutoff),
    ))
    .orderBy(broadcastTimelineEventsTable.stationId, desc(broadcastTimelineEventsTable.occurredAt));
}

export async function getListenerBroadcastAdvisories(
  stationIds: readonly number[],
  trackObservedAtByStation: ReadonlyMap<number, Date>,
  now = new Date(),
): Promise<Map<number, ListenerBroadcastAdvisory>> {
  if (stationIds.length === 0) return new Map();
  const cutoff = new Date(now.getTime() - LISTENER_BROADCAST_ADVISORY_TTL_MS);
  const [captures, resumptions] = await Promise.all([
    _testOnly_listenerCaptureQuery(stationIds, cutoff),
    _testOnly_listenerResumptionQuery(stationIds, cutoff),
  ]);
  const captureByStation = new Map(captures.map((row) => [row.stationId, row]));
  const resumptionByStation = new Map(resumptions.map((row) => [row.stationId, row]));
  const result = new Map<number, ListenerBroadcastAdvisory>();
  for (const stationId of stationIds) {
    const advisory = deriveListenerBroadcastAdvisory({
      capture: captureByStation.get(stationId),
      resumption: resumptionByStation.get(stationId),
      trackObservedAt: trackObservedAtByStation.get(stationId),
      now,
    });
    if (advisory) result.set(stationId, advisory);
  }
  return result;
}