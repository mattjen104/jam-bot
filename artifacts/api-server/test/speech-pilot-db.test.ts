import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  db,
  stationsTable,
} from "@workspace/db";
import {
  appendBroadcastTimelineEvent,
  appendCaptureDecision,
  appendCaptureOutcome,
  appendScheduleComparison,
  appendTranscriptClaim,
  appendTranscriptSegment,
} from "../src/lore/observability.js";
import { getSpeechPilotRunReport } from "../src/scripts/run-speech-pilot.js";

const suffix = randomUUID();
const runId = `speech-pilot-db-${suffix}`;
const otherRunId = `speech-pilot-db-other-${suffix}`;
const keys = {
  decision: `${runId}:decision`,
  outcome: `${runId}:outcome`,
  segment: `${runId}:segment`,
  claim: `${runId}:claim`,
  comparison: `${runId}:comparison`,
  timeline: `${runId}:timeline`,
};

describe("speech pilot durable report", () => {
  it("persists append-only evidence idempotently and isolates the run report", async () => {
    // Evidence is intentionally undeletable, so attach the uniquely keyed test
    // rows to an existing station instead of creating a fixture we cannot remove.
    const [station] = await db.select({ id: stationsTable.id }).from(stationsTable).limit(1);
    expect(station).toBeDefined();
    const stationId = station!.id;
    const common = {
      stationId,
      producerVersion: "speech-shadow.pilot.v1",
      featureSnapshot: {},
      provenance: { pilotRunId: runId },
    };
    const at = new Date();
    const appendAll = async () => {
      await appendCaptureDecision({ ...common, decidedAt: at, decision: "sampled", outcome: "admitted", idempotencyKey: keys.decision });
      await appendCaptureOutcome({ ...common, occurredAt: at, outcome: "speech", decisionIdempotencyKey: keys.decision, idempotencyKey: keys.outcome });
      await appendTranscriptSegment({ ...common, capturedAt: at, outcome: "speech", idempotencyKey: keys.segment });
      await appendTranscriptClaim({ ...common, claimedAt: at, outcome: "grounded", segmentIdempotencyKey: keys.segment, idempotencyKey: keys.claim });
      await appendScheduleComparison({ ...common, comparedAt: at, outcome: "supporting", idempotencyKey: keys.comparison });
      await appendBroadcastTimelineEvent({ ...common, occurredAt: at, eventType: "speech_ends_then_sustained_music", outcome: "advisory", idempotencyKey: keys.timeline });
    };
    await appendAll();
    await appendAll();
    await appendCaptureOutcome({
      ...common,
      provenance: { pilotRunId: otherRunId },
      occurredAt: at,
      outcome: "capture_failure",
      idempotencyKey: `${otherRunId}:outcome`,
    });

    const report = await getSpeechPilotRunReport(runId, [stationId]);
    expect(report.aggregate).toMatchObject({
      captures: 1,
      outcomes: { speech: 1 },
      transcriptSegments: 1,
      groundedClaims: 1,
      scheduleComparisons: { supporting: 1 },
      timelineEvidence: 1,
    });
    expect(report.stations[0]).toMatchObject({
      stationId,
      transcriptSegments: 1,
      groundedClaims: 1,
    });
    expect(report.stations[0]!.decisions).toHaveLength(1);
  });
});