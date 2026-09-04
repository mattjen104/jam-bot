import { type Station } from "@workspace/db";
import { appendBroadcastTimelineEvent, appendCaptureDecision, appendCaptureOutcome, appendScheduleComparison, appendTranscriptClaim, appendTranscriptSegment, getSpeechPilotHealth, type SpeechPilotHealth, type SpeechPilotThresholds } from "./observability.js";
import { assertPublicHttpStreamUrl, deriveSpeechEndsThenSustainedMusic, LocalSttAdapter, withTransientSpeechClip } from "./speech-capture.js";
import { extractExplicitGroundedClaims } from "./speech-grounding.js";
import { compareTranscriptToSchedule, lookupActiveScheduleEntry } from "./speech-schedule-comparison.js";
import { SpeechQuotaScheduler, type SpeechMount } from "./speech-scheduler.js";
import { estimateTalkWindows, type TalkObservation } from "./speech-talk-window.js";

const PRODUCER_VERSION = "speech-shadow.pilot.v1";
const activeStations = new Set<number>();
let scheduler: SpeechQuotaScheduler | null = null;
let stt: LocalSttAdapter | null = null;
let started = false;
const talkHistory: TalkObservation[] = [];
let cohortStationIds: number[] = [];
let pilotKilled = false;
let lastHealthCheckAt = 0;
let lastPilotHealth: SpeechPilotHealth | null = null;

function integerEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function ratioEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function parseSpeechPilotCohort(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function pilotThresholds(): SpeechPilotThresholds {
  return {
    minimumSamples: integerEnv("LORE_SPEECH_PILOT_MIN_SAMPLES", 20),
    minimumSpeechYield: ratioEnv("LORE_SPEECH_PILOT_MIN_SPEECH_YIELD", 0.1),
    minimumOverlapYield: ratioEnv("LORE_SPEECH_PILOT_MIN_OVERLAP_YIELD", 0),
    minimumScheduleAgreement: ratioEnv("LORE_SPEECH_PILOT_MIN_SCHEDULE_AGREEMENT", 0.5),
    maximumBoundaryErrorMs: integerEnv("LORE_SPEECH_PILOT_MAX_BOUNDARY_ERROR_MS", 5_000),
    maximumFailureRate: ratioEnv("LORE_SPEECH_PILOT_MAX_FAILURE_RATE", 0.2),
  };
}

/**
 * Fail closed. In particular, an API key alone can never enable speech
 * collection: this path accepts a local executable and local model only.
 */
export function speechShadowEnabled(env = process.env): boolean {
  const cohort = parseSpeechPilotCohort(env["LORE_SPEECH_PILOT_STATION_IDS"]);
  const maximumCohortSize = Number(env["LORE_SPEECH_PILOT_MAX_STATIONS"] ?? 5);
  return env["LORE_SPEECH_SHADOW_ENABLED"] === "true" &&
    env["LORE_SPEECH_CAPTURE_ENABLED"] === "true" &&
    !!env["LORE_SPEECH_LOCAL_STT_EXECUTABLE"]?.trim() &&
    !!env["LORE_SPEECH_LOCAL_STT_MODEL"]?.trim() &&
    !!env["LORE_SPEECH_CLASSIFIER_EXECUTABLE"]?.trim() &&
    !!env["LORE_SPEECH_SILERO_VAD_EXECUTABLE"]?.trim() &&
    !!env["LORE_SPEECH_FFMPEG_EXECUTABLE"]?.trim() &&
    cohort.length > 0 &&
    Number.isInteger(maximumCohortSize) && maximumCohortSize > 0 &&
    cohort.length <= maximumCohortSize;
}

export function mountsFor(station: Station): SpeechMount[] {
  const config = (station.nowPlayingConfig ?? {}) as Record<string, unknown>;
  const configured = Array.isArray(config.mounts) ? config.mounts : [];
  const mounts = configured.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const mount = value as { url?: unknown; bitrate?: unknown };
    if (typeof mount.url !== "string" || !mount.url) return [];
    return [{ url: mount.url, estimatedCost: typeof mount.bitrate === "number" ? mount.bitrate : 1_000 }];
  });
  const fallback = typeof config.streamUrl === "string" && config.streamUrl ? config.streamUrl : station.streamUrl;
  if (fallback) mounts.push({ url: fallback, estimatedCost: 1_000 });
  return [...new Map(mounts.map((mount) => [mount.url, mount])).values()];
}

export function startSpeechShadowOrchestrator(): boolean {
  if (started) return true;
  if (!speechShadowEnabled()) return false;
  cohortStationIds = parseSpeechPilotCohort(process.env["LORE_SPEECH_PILOT_STATION_IDS"]);
  pilotKilled = false;
  lastHealthCheckAt = 0;
  lastPilotHealth = null;
  scheduler = new SpeechQuotaScheduler({
    enabled: true,
    stagedStationIds: cohortStationIds,
    maxCapturesPerStation: integerEnv("LORE_SPEECH_MAX_PER_STATION", 1),
    maxCapturesPerWindow: integerEnv("LORE_SPEECH_MAX_PER_WINDOW", 3),
    windowMs: integerEnv("LORE_SPEECH_WINDOW_MS", 30 * 60_000),
  });
  stt = new LocalSttAdapter({
    executable: process.env["LORE_SPEECH_LOCAL_STT_EXECUTABLE"],
    modelPath: process.env["LORE_SPEECH_LOCAL_STT_MODEL"],
    timeoutMs: integerEnv("LORE_SPEECH_STT_TIMEOUT_MS", 45_000),
    maxConcurrency: integerEnv("LORE_SPEECH_MAX_CONCURRENCY", 1),
    maxCpuMs: integerEnv("LORE_SPEECH_STT_MAX_CPU_MS", 45_000),
    maxMemoryBytes: integerEnv("LORE_SPEECH_STT_MAX_MEMORY_BYTES", 1_000_000_000),
    classifier: {
      executable: process.env["LORE_SPEECH_CLASSIFIER_EXECUTABLE"],
      modelPath: process.env["LORE_SPEECH_CLASSIFIER_MODEL"]?.trim() || undefined,
      timeoutMs: integerEnv("LORE_SPEECH_CLASSIFIER_TIMEOUT_MS", 15_000),
      maxCpuMs: integerEnv("LORE_SPEECH_CLASSIFIER_MAX_CPU_MS", 15_000),
      maxMemoryBytes: integerEnv("LORE_SPEECH_CLASSIFIER_MAX_MEMORY_BYTES", 512_000_000),
    },
    vad: {
      executable: process.env["LORE_SPEECH_SILERO_VAD_EXECUTABLE"],
      modelPath: process.env["LORE_SPEECH_SILERO_VAD_MODEL"]?.trim() || undefined,
      timeoutMs: integerEnv("LORE_SPEECH_VAD_TIMEOUT_MS", 15_000),
      maxCpuMs: integerEnv("LORE_SPEECH_VAD_MAX_CPU_MS", 15_000),
      maxMemoryBytes: integerEnv("LORE_SPEECH_VAD_MAX_MEMORY_BYTES", 512_000_000),
    },
  });
  started = true;
  return true;
}

export function stopSpeechShadowOrchestrator(): void {
  started = false;
  scheduler = null;
  stt = null;
  activeStations.clear();
  talkHistory.length = 0;
  cohortStationIds = [];
  pilotKilled = false;
  lastHealthCheckAt = 0;
  lastPilotHealth = null;
}

export function getSpeechPilotRuntimeStatus() {
  return {
    configured: speechShadowEnabled(),
    running: started,
    killed: pilotKilled,
    cohortStationIds: [...cohortStationIds],
    activeCaptures: activeStations.size,
    health: lastPilotHealth,
  };
}

async function refreshPilotGate(force = false): Promise<boolean> {
  if (pilotKilled) return false;
  const now = Date.now();
  if (!force && now - lastHealthCheckAt < integerEnv("LORE_SPEECH_PILOT_HEALTH_REFRESH_MS", 60_000)) return true;
  lastHealthCheckAt = now;
  lastPilotHealth = await getSpeechPilotHealth(
    cohortStationIds,
    pilotThresholds(),
    integerEnv("LORE_SPEECH_PILOT_WINDOW_HOURS", 24),
  );
  if (!lastPilotHealth.healthy) {
    pilotKilled = true;
    scheduler = null;
    return false;
  }
  return true;
}

export async function getSpeechPilotAdminStatus() {
  if (started && !pilotKilled) {
    try {
      await refreshPilotGate(true);
    } catch {
      pilotKilled = true;
      scheduler = null;
    }
  }
  return getSpeechPilotRuntimeStatus();
}

/**
 * Transition candidates are high-ranked talk windows: DJs commonly speak at
 * boundaries. The station-level active set protects the transient capture
 * pipeline from overlapping poller/watcher evidence.
 */
/**
 * `runId` is supplied only by the bounded operator runner.  It deliberately
 * does not loosen normal admission; it makes the append-only evidence and
 * reservations attributable to a single invocation.
 */
export function scheduleSpeechTransitionCandidate(station: Station, runId?: string, signal?: AbortSignal): Promise<void> {
  if (!started || !scheduler || !stt || pilotKilled || activeStations.has(station.id) ||
    !cohortStationIds.includes(station.id) ||
    activeStations.size >= integerEnv("LORE_SPEECH_MAX_CONCURRENCY", 1)) return Promise.resolve();
  return new Promise((complete) => {
  void refreshPilotGate().then(async (healthy) => {
    if (!healthy || !scheduler || !stt || signal?.aborted || activeStations.has(station.id)) { complete(); return; }
  const at = new Date();
  const mounts = mountsFor(station);
  const rank = estimateTalkWindows(talkHistory, at).find((entry) => entry.stationId === station.id)?.score ?? 0;
   const admission = scheduler.reserve(station.id, at, mounts, runId);
   const captureKey = `${admission.kind === "sampled" ? admission.reservation.id : `${station.id}:${Math.floor(at.getTime() / 60_000)}`}${runId ? `:run:${runId}` : ""}`;
   const decisionKey = `speech-shadow:decision:${captureKey}`;
   try {
   await appendCaptureDecision({
    stationId: station.id, decidedAt: at, decision: admission.kind,
    idempotencyKey: decisionKey, producerVersion: PRODUCER_VERSION,
    outcome: admission.kind === "sampled" ? admission.reason : admission.reason,
     featureSnapshot: { candidate: runId ? "operator_one_shot" : "transition", rank, mounts: mounts.length },
     provenance: { provider: "local_only", source: station.nowPlayingSource ?? "unknown", ...(runId ? { pilotRunId: runId } : {}) },
   });
   } catch {
     // Evidence is a prerequisite for collection; never capture an
     // unaccountable clip when the append-only ledger is unavailable.
     complete();
     return;
   }
   if (admission.kind !== "sampled" || admission.reason === "idempotent") { complete(); return; }
  activeStations.add(station.id);
  const reservation = admission.reservation;
   // The global is reset by stop; retain the admitted adapter for this entire
   // in-flight capture so teardown cannot turn an abort into a null dereference.
   const adapter = stt;
  void assertPublicHttpStreamUrl(reservation.mountUrl).then((target) => withTransientSpeechClip(
    target.pinnedUrl,
    {
      ffmpegExecutable: process.env["LORE_SPEECH_FFMPEG_EXECUTABLE"],
      durationSeconds: integerEnv("LORE_SPEECH_CAPTURE_SECONDS", 30),
      timeoutMs: integerEnv("LORE_SPEECH_CAPTURE_TIMEOUT_MS", 45_000),
       maxBytes: integerEnv("LORE_SPEECH_CAPTURE_MAX_BYTES", 2_000_000),
      originalAuthority: target.originalAuthority,
       originalHostname: target.originalHostname, signal,
    },
     async (clip) => ({ outcome: await adapter.transcribe(clip.path, signal), clip }),
  )).then(async ({ outcome, clip }) => {
    const classifierIntervals = "intervals" in outcome ? outcome.intervals : undefined;
    const boundary = classifierIntervals
      ? deriveSpeechEndsThenSustainedMusic(classifierIntervals)
      : null;
    if (boundary) {
      await appendBroadcastTimelineEvent({
        stationId: station.id,
        eventType: "speech_ends_then_sustained_music",
        occurredAt: new Date(clip.startedAt.getTime() + boundary.musicStartedAtMs),
         idempotencyKey: `speech-shadow:timeline:${captureKey}:speech-music`,
        producerVersion: PRODUCER_VERSION,
        outcome: "advisory",
        featureSnapshot: {
          ...boundary,
          intervals: classifierIntervals,
          captureStartedAt: clip.startedAt.toISOString(),
          uncertaintyMs: Math.max(0, clip.endedAt.getTime() - clip.startedAt.getTime()),
          advisoryOnly: true,
        },
        provenance: {
          provider: "local_classifier",
          classifierVersion: "local_classifier_intervals.v1",
           identityInput: false, ...(runId ? { pilotRunId: runId } : {}),
        },
      });
    }
    if (outcome.kind === "speech" || outcome.kind === "speech_over_music") {
      const claims = extractExplicitGroundedClaims(outcome.segments);
      for (const [index, segment] of outcome.segments.entries()) {
        const capturedAt = new Date(clip.startedAt.getTime() + segment.startedAtMs);
         const segmentKey = `speech-shadow:segment:${captureKey}:${index}`;
        await appendTranscriptSegment({
          stationId: station.id, capturedAt, idempotencyKey: segmentKey, producerVersion: PRODUCER_VERSION,
          outcome: outcome.kind, featureSnapshot: { ...segment, confidence: null },
           provenance: { provider: "local_stt", model: process.env["LORE_SPEECH_LOCAL_STT_MODEL"], captureStartedAt: clip.startedAt.toISOString(), ...(runId ? { pilotRunId: runId } : {}) },
        });
        for (const [claimIndex, claim] of claims.entries()) {
          if (claim.segmentIndex !== index) continue;
          await appendTranscriptClaim({
            stationId: station.id, claimedAt: capturedAt, segmentIdempotencyKey: segmentKey,
            idempotencyKey: `${segmentKey}:claim:${claimIndex}`, producerVersion: PRODUCER_VERSION,
             outcome: "grounded", featureSnapshot: { ...claim }, provenance: { extractor: "exact_pattern.v1", ...(runId ? { pilotRunId: runId } : {}) },
          });
          if (claim.kind === "dj" || claim.kind === "show") {
            const scheduled = await lookupActiveScheduleEntry(station.id, station.ianaTimezone, capturedAt);
            const scheduledValue = claim.kind === "dj" ? scheduled?.djName : scheduled?.showName;
            const comparison = compareTranscriptToSchedule(claim.value, scheduledValue);
            await appendScheduleComparison({
              stationId: station.id,
              comparedAt: capturedAt,
              idempotencyKey: `${segmentKey}:schedule:${claimIndex}`,
              producerVersion: PRODUCER_VERSION,
              outcome: comparison,
              featureSnapshot: {
                claim: {
                  kind: claim.kind,
                  value: claim.value,
                  segmentIndex: claim.segmentIndex,
                  startedAtMs: claim.startedAtMs,
                  endedAtMs: claim.endedAtMs,
                  exactTranscriptSpan: outcome.segments[index]!.text.slice(claim.startChar, claim.endChar),
                  startChar: claim.startChar,
                  endChar: claim.endChar,
                },
                scheduled: scheduled ? {
                  value: scheduledValue,
                  showName: scheduled.showName,
                  djName: scheduled.djName,
                  sourceUrl: scheduled.sourceUrl,
                  extraction: scheduled.extraction,
                  scheduleKind: scheduled.scheduleKind,
                } : null,
                confidence: "deterministic_exact_span",
              },
              provenance: {
                comparison: "normalized_exact_name.v1",
                scheduleReadOnly: true,
                clipTime: capturedAt.toISOString(),
                 timezone: station.ianaTimezone, ...(runId ? { pilotRunId: runId } : {}),
              },
            });
          }
        }
      }
      talkHistory.push(...outcome.segments.map((segment) => ({
        stationId: station.id, startedAt: new Date(clip.startedAt.getTime() + segment.startedAtMs),
        endedAt: new Date(clip.startedAt.getTime() + segment.endedAtMs), speechConfidence: 1,
      })));
      if (talkHistory.length > 500) talkHistory.splice(0, talkHistory.length - 500);
    }
    return appendCaptureOutcome({
    stationId: station.id, occurredAt: new Date(), decisionIdempotencyKey: decisionKey,
     idempotencyKey: `speech-shadow:outcome:${captureKey}`,
    producerVersion: PRODUCER_VERSION, outcome: outcome.kind,
     featureSnapshot: { candidate: runId ? "operator_one_shot" : "transition", localOnly: true, rank },
     provenance: { provider: "local_stt", captureStartedAt: at.toISOString(), ...(runId ? { pilotRunId: runId } : {}) },
  });
  }).catch((error) => appendCaptureOutcome({
    stationId: station.id, occurredAt: new Date(), decisionIdempotencyKey: decisionKey,
     idempotencyKey: `speech-shadow:outcome:${captureKey}`,
    producerVersion: PRODUCER_VERSION, outcome: "capture_failure",
     featureSnapshot: { candidate: runId ? "operator_one_shot" : "transition", localOnly: true },
     provenance: { provider: "local_stt", error: error instanceof Error ? error.message : String(error), ...(runId ? { pilotRunId: runId } : {}) },
  })).finally(() => { activeStations.delete(station.id); complete(); });
  }).catch(() => {
    pilotKilled = true;
    scheduler = null;
    complete();
  });
  });
}