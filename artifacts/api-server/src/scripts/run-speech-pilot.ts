/* eslint-disable no-console -- intentionally an operator-facing command */
/**
 * A deliberately small, one-shot entrypoint.  It never enables the normal
 * watcher: it supplies explicit station candidates to the same orchestrator
 * used by transition events and then waits for its bounded work to drain.
 */
import { access, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  captureOutcomesTable,
  captureDecisionsTable,
  db,
  stationsTable,
  transcriptClaimsTable,
  scheduleComparisonsTable,
  broadcastTimelineEventsTable,
  transcriptSegmentsTable,
} from "@workspace/db";
import { and, inArray, sql } from "drizzle-orm";
import { assertPublicHttpStreamUrl, withTransientSpeechClip } from "../lore/speech-capture.js";
import { selectCheapestMount } from "../lore/speech-scheduler.js";
import {
  getSpeechPilotAdminStatus,
  mountsFor,
  parseSpeechPilotCohort,
  scheduleSpeechTransitionCandidate,
  speechShadowEnabled,
  startSpeechShadowOrchestrator,
  stopSpeechShadowOrchestrator,
} from "../lore/speech-shadow-orchestrator.js";
import { getSpeechPilotHealth } from "../lore/observability.js";

export type PilotArgs = { stationIds: number[]; timeoutMs: number; json: boolean; preflightOnly: boolean };
export type Preflight = { ok: boolean; runReady: boolean; errors: string[]; stations: Array<typeof stationsTable.$inferSelect> };

const EXECUTABLES = [
  "LORE_SPEECH_FFMPEG_EXECUTABLE",
  "LORE_SPEECH_CLASSIFIER_EXECUTABLE",
  "LORE_SPEECH_SILERO_VAD_EXECUTABLE",
  "LORE_SPEECH_LOCAL_STT_EXECUTABLE",
] as const;
const MODELS = [
  "LORE_SPEECH_LOCAL_STT_MODEL",
  "LORE_SPEECH_CLASSIFIER_MODEL",
  "LORE_SPEECH_SILERO_VAD_MODEL",
] as const;

export function parsePilotArgs(argv: string[]): PilotArgs {
  const value = argv.find((arg) => arg.startsWith("--stations="))?.slice(11);
  const timeout = Number(argv.find((arg) => arg.startsWith("--timeout-seconds="))?.slice(18) ?? "120");
  if (!value) throw new Error("--stations=ID,ID is required; the cohort is never inferred");
  const stationIds = parseSpeechPilotCohort(value);
  if (!stationIds.length || stationIds.length > 5 || stationIds.length !== value.split(",").length) {
    throw new Error("--stations must be 1-5 unique positive integer IDs");
  }
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 900) {
    throw new Error("--timeout-seconds must be an integer from 10 through 900");
  }
  return { stationIds, timeoutMs: timeout * 1_000, json: argv.includes("--json"), preflightOnly: argv.includes("--preflight") };
}

export function runSpeechRuntimeCheck(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("compatibility check timed out")); }, 5_000);
    const append = (chunk: Buffer) => { output = (output + chunk).slice(0, 64_000); };
    child.stdout.on("data", append); child.stderr.on("data", append);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`compatibility check exited ${code}`));
      else resolve(output);
    });
  });
}

export async function verifySpeechRuntimeExecutable(
  executable: string,
  component: "ffmpeg" | "classifier" | "vad" | "stt",
): Promise<void> {
  if (component === "ffmpeg") {
    const output = await runSpeechRuntimeCheck(executable, ["-formats"]);
    if (!/\bWAV\b/i.test(output)) throw new Error("ffmpeg does not advertise WAV support");
    return;
  }
  const output = await runSpeechRuntimeCheck(executable, [
    "--self-test", "--output-format", "json",
  ]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("self-test did not return JSON");
  }
  const contract = parsed as Record<string, unknown>;
  if (contract["contract"] !== "lore-speech-local.v1" ||
      contract["component"] !== component ||
      contract["outputFormat"] !== "json" ||
      contract["localOnly"] !== true) {
    throw new Error(
      `self-test must return contract=lore-speech-local.v1, component=${component}, outputFormat=json, localOnly=true`,
    );
  }
}

/** Does no capture. Every error is actionable and capture is fail-closed. */
export async function preflightSpeechPilot(args: PilotArgs, env = process.env): Promise<Preflight> {
  const errors: string[] = [];
  for (const name of EXECUTABLES) {
    const value = env[name]?.trim();
    if (!value) errors.push(`${name} is required`);
    else {
      const component = name === "LORE_SPEECH_FFMPEG_EXECUTABLE" ? "ffmpeg"
        : name === "LORE_SPEECH_CLASSIFIER_EXECUTABLE" ? "classifier"
          : name === "LORE_SPEECH_SILERO_VAD_EXECUTABLE" ? "vad"
            : "stt";
      await access(value)
        .then(() => verifySpeechRuntimeExecutable(value, component))
        .catch((error) => errors.push(`${name} is incompatible: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  for (const name of MODELS) {
    const value = env[name]?.trim();
    if (name === "LORE_SPEECH_LOCAL_STT_MODEL" && !value) errors.push(`${name} is required`);
    else if (value) {
      await Promise.all([access(value), stat(value).then((entry) => {
        if (!entry.isFile()) throw new Error("not a regular file");
      })]).catch((error) =>
        errors.push(`${name} is not a readable regular file: ${error instanceof Error ? error.message : value}`));
    }
  }
  const captureEnabled = env.LORE_SPEECH_SHADOW_ENABLED === "true" && env.LORE_SPEECH_CAPTURE_ENABLED === "true";
  if (!captureEnabled) {
    errors.push("LORE_SPEECH_SHADOW_ENABLED=true and LORE_SPEECH_CAPTURE_ENABLED=true are required");
  }
  const maxConcurrent = Number(env.LORE_SPEECH_MAX_CONCURRENCY ?? "1");
  const captureSeconds = Number(env.LORE_SPEECH_CAPTURE_SECONDS ?? "30");
  const maxBytes = Number(env.LORE_SPEECH_CAPTURE_MAX_BYTES ?? "2000000");
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > args.stationIds.length) errors.push("LORE_SPEECH_MAX_CONCURRENCY must be 1 through cohort size");
  if (!Number.isInteger(captureSeconds) || captureSeconds < 1 || captureSeconds > 120) errors.push("LORE_SPEECH_CAPTURE_SECONDS must be 1 through 120");
  if (!Number.isInteger(maxBytes) || maxBytes < 16_000) errors.push("LORE_SPEECH_CAPTURE_MAX_BYTES must be at least 16000");
  let stations: Array<typeof stationsTable.$inferSelect> = [];
  try {
    await db.execute(sql`select 1`);
    stations = await db.select().from(stationsTable).where(inArray(stationsTable.id, args.stationIds));
    stations.sort((a, b) => args.stationIds.indexOf(a.id) - args.stationIds.indexOf(b.id));
    const found = new Set(stations.map((station) => station.id));
    for (const id of args.stationIds) if (!found.has(id)) errors.push(`station ${id} does not exist`);
    for (const station of stations) {
      const mount = selectCheapestMount(mountsFor(station));
      if (!mount) { errors.push(`station ${station.id} has no stream mount`); continue; }
      try {
        const target = await assertPublicHttpStreamUrl(mount.url);
        // This is a one-second decode/readiness probe, not pilot evidence:
        // withTransientSpeechClip removes the generated WAV before returning.
        if (captureEnabled && env.LORE_SPEECH_FFMPEG_EXECUTABLE?.trim()) {
          await withTransientSpeechClip(target.pinnedUrl, {
            ffmpegExecutable: env.LORE_SPEECH_FFMPEG_EXECUTABLE, durationSeconds: 1,
            timeoutMs: Math.min(Number(env.LORE_SPEECH_CAPTURE_TIMEOUT_MS ?? 45_000), 10_000),
            maxBytes: Math.min(Number(env.LORE_SPEECH_CAPTURE_MAX_BYTES ?? 2_000_000), 250_000),
            originalAuthority: target.originalAuthority, originalHostname: target.originalHostname,
          }, async () => undefined);
        }
      } catch (error) {
        errors.push(`station ${station.id} mount/probe rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    errors.push(`database/schema is not ready: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ok: !errors.length, runReady: !errors.length && captureEnabled, errors, stations };
}

const thresholds = { minimumSamples: 20, minimumSpeechYield: .1, minimumOverlapYield: 0, minimumScheduleAgreement: .5, maximumBoundaryErrorMs: 5_000, maximumFailureRate: .2 };
/** Query seam for operator reports and DB integration tests; provenance is the
 * run boundary so no rolling/organic rows can leak into an invocation. */
export async function getSpeechPilotRunReport(runId: string, stationIds: number[]) {
  const [outcomes, decisions, segments, claims, comparisons, timeline] = await Promise.all([
    db.select({ stationId: captureOutcomesTable.stationId, outcome: captureOutcomesTable.outcome }).from(captureOutcomesTable).where(and(inArray(captureOutcomesTable.stationId, stationIds), sql`${captureOutcomesTable.provenance}->>'pilotRunId' = ${runId}`)),
    db.select({ stationId: captureDecisionsTable.stationId, decision: captureDecisionsTable.decision, outcome: captureDecisionsTable.outcome }).from(captureDecisionsTable).where(and(inArray(captureDecisionsTable.stationId, stationIds), sql`${captureDecisionsTable.provenance}->>'pilotRunId' = ${runId}`)),
    db.select({ stationId: transcriptSegmentsTable.stationId }).from(transcriptSegmentsTable).where(and(inArray(transcriptSegmentsTable.stationId, stationIds), sql`${transcriptSegmentsTable.provenance}->>'pilotRunId' = ${runId}`)),
    db.select({ stationId: transcriptClaimsTable.stationId }).from(transcriptClaimsTable).where(and(inArray(transcriptClaimsTable.stationId, stationIds), sql`${transcriptClaimsTable.provenance}->>'pilotRunId' = ${runId}`)),
    db.select({ stationId: scheduleComparisonsTable.stationId, outcome: scheduleComparisonsTable.outcome }).from(scheduleComparisonsTable).where(and(inArray(scheduleComparisonsTable.stationId, stationIds), sql`${scheduleComparisonsTable.provenance}->>'pilotRunId' = ${runId}`)),
    db.select({ stationId: broadcastTimelineEventsTable.stationId, eventType: broadcastTimelineEventsTable.eventType }).from(broadcastTimelineEventsTable).where(and(inArray(broadcastTimelineEventsTable.stationId, stationIds), sql`${broadcastTimelineEventsTable.provenance}->>'pilotRunId' = ${runId}`)),
  ]);
  const count = <T extends { outcome: string }>(rows: T[]) => rows.reduce<Record<string, number>>((r, row) => { r[row.outcome] = (r[row.outcome] ?? 0) + 1; return r; }, {});
  return {
    stations: stationIds.map((stationId) => ({
      stationId,
      decisions: decisions.filter((r) => r.stationId === stationId),
      outcomes: outcomes.filter((r) => r.stationId === stationId),
      transcriptSegments: segments.filter((r) => r.stationId === stationId).length,
      groundedClaims: claims.filter((r) => r.stationId === stationId).length,
      scheduleComparisons: comparisons.filter((r) => r.stationId === stationId),
      timelineEvidence: timeline.filter((r) => r.stationId === stationId),
    })),
    aggregate: { captures: outcomes.length, outcomes: count(outcomes), transcriptSegments: segments.length, groundedClaims: claims.length, scheduleComparisons: count(comparisons), timelineEvidence: timeline.length, insufficientSamples: outcomes.length < thresholds.minimumSamples },
  };
}
export async function runSpeechPilot(args: PilotArgs): Promise<Record<string, unknown>> {
  const oldCohort = process.env.LORE_SPEECH_PILOT_STATION_IDS;
  let interrupt: (() => void) | undefined;
  try {
    // This mutation is process-local and cannot turn on a server watcher.
    process.env.LORE_SPEECH_PILOT_STATION_IDS = args.stationIds.join(",");
    const preflight = await preflightSpeechPilot(args);
    if (!preflight.ok) return { runId: null, preflight, completed: false };
    if (!speechShadowEnabled()) return { runId: null, preflight: { ...preflight, ok: false, errors: [...preflight.errors, "runtime configuration is not eligible"] }, completed: false };
    const runId = randomUUID();
    const startedAt = new Date();
    let interrupted = false;
    const controller = new AbortController();
    interrupt = () => { interrupted = true; controller.abort(); };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    if (!startSpeechShadowOrchestrator()) throw new Error("speech orchestrator refused to start");
    // Workers are a real queue: candidates denied solely because another
    // capture is active are not discarded. Each worker awaits the production
    // completion seam before taking the next station.
    let next = 0;
    const workers = Array.from({ length: Math.min(
      Number(process.env.LORE_SPEECH_MAX_CONCURRENCY ?? "1"), preflight.stations.length,
    ) }, async () => {
      while (!interrupted) {
        const station = preflight.stations[next++];
        if (!station) return;
        await scheduleSpeechTransitionCandidate(station, runId, controller.signal);
        if ((await getSpeechPilotAdminStatus()).killed) return;
      }
    });
    let timedOut = false;
    const timeoutHandle = setTimeout(() => { timedOut = true; controller.abort(); }, args.timeoutMs);
    // Never emit the report while ffmpeg/model children or their finally clip
    // removal are still running.
    await Promise.all(workers);
    clearTimeout(timeoutHandle);
    const runReport = await getSpeechPilotRunReport(runId, args.stationIds);
    const health = await getSpeechPilotHealth(args.stationIds, thresholds, 24);
    return { runId, startedAt: startedAt.toISOString(), completed: !timedOut && !interrupted, timedOut, interrupted,
      ...runReport,
      // This intentionally remains a rolling production gate, not a
      // misleading one-run quality verdict.
      rollingProductionHealth: health,
      killed: (await getSpeechPilotAdminStatus()).killed };
  } finally {
    if (interrupt) {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
    stopSpeechShadowOrchestrator();
    if (oldCohort == null) delete process.env.LORE_SPEECH_PILOT_STATION_IDS;
    else process.env.LORE_SPEECH_PILOT_STATION_IDS = oldCohort;
  }
}

export function formatPilotReport(result: Record<string, unknown>): string {
  if ("ok" in result && !("runId" in result)) {
    const readiness = result as { ok?: boolean; runReady?: boolean; errors?: string[] };
    return [
      `Speech pilot preflight ${readiness.ok && readiness.runReady ? "PASSED" : "FAILED"}`,
      ...(readiness.errors ?? []).map((error) => `- ${error}`),
    ].join("\n");
  }
  const preflight = result.preflight as { ok?: boolean; errors?: string[] } | undefined;
  if (preflight && !preflight.ok) return `Speech pilot preflight FAILED\n${(preflight.errors ?? []).map((error) => `- ${error}`).join("\n")}`;
  const aggregate = result.aggregate as { captures?: number; transcriptSegments?: number; groundedClaims?: number; outcomes?: Record<string, number>; scheduleComparisons?: Record<string, number>; insufficientSamples?: boolean } | undefined;
  const stations = result.stations as Array<{ stationId: number; decisions?: Array<{ decision: string; outcome: string }>; outcomes: Array<{ outcome: string }> }> | undefined;
  const rolling = result.rollingProductionHealth as { sampleReady?: boolean; healthy?: boolean; regressions?: string[] } | undefined;
  return [
    `Speech pilot ${result.completed ? "completed" : "incomplete"}: ${result.runId ?? "no run id"}`,
    ...(stations ?? []).map((station) => `station ${station.stationId}: decisions=${station.decisions?.map((row) => `${row.decision}:${row.outcome}`).join(", ") || "none"}; outcomes=${station.outcomes.map((row) => row.outcome).join(", ") || "none"}`),
    `captures=${aggregate?.captures ?? 0}; segments=${aggregate?.transcriptSegments ?? 0}; groundedClaims=${aggregate?.groundedClaims ?? 0}`,
    `outcomes: ${Object.entries(aggregate?.outcomes ?? {}).map(([kind, count]) => `${kind}=${count}`).join(", ") || "none"}`,
    `schedule: ${Object.entries(aggregate?.scheduleComparisons ?? {}).map(([kind, count]) => `${kind}=${count}`).join(", ") || "none"}`,
    `pilot gate: ${result.killed ? "KILLED" : result.completed ? "advisory / completed" : "INCOMPLETE"}; ${aggregate?.insufficientSamples ? "insufficient run samples" : "run sample count met"}`,
    `rolling health: sampleReady=${rolling?.sampleReady ?? false}; healthy=${rolling?.healthy ?? false}; regressions=${rolling?.regressions?.join(",") || "none"}`,
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parsePilotArgs(process.argv.slice(2));
    const result = args.preflightOnly ? await preflightSpeechPilot(args) : await runSpeechPilot(args);
    console.log(args.json ? JSON.stringify(result, null, 2) : formatPilotReport(result));
    process.exitCode = ("ok" in result && !result.ok) || ("completed" in result && !result.completed) ? 1 : 0;
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; }
}