import { EventEmitter } from "node:events";
import {
  db,
  recordingsTable,
  replayResolutionJobsTable,
  serviceTrackMapTable,
  type ReplayResolutionFailure,
  type ReplayResolutionJob,
} from "@workspace/db";
import { and, asc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { fetchOdesli } from "@workspace/song-enrichment";
import { getReplayManifest } from "./replay.js";

const ODESLI_JOB_GAP_MS = 1_000;
const FAILURE_CAP = 100;
const activeWorkers = new Set<number>();
let odesliJobChain: Promise<unknown> = Promise.resolve();

export const replayResolutionEvents = new EventEmitter();

export type ReplayResolutionMissBreakdown = {
  noVector: number;
  noLinks: number;
  noRecording: number;
};
export type ReplayResolutionProgress = {
  id: number;
  replayId: number;
  status: string;
  total: number;
  processed: number;
  resolved: number;
  missing: number;
  failed: number;
  committedOffset: number;
  error: string | null;
  finishedAt: string | null;
  failures: ReplayResolutionFailure[];
  missBreakdown: ReplayResolutionMissBreakdown;
};

export interface ReplayMaterializer {
  service: string;
  canMaterialize(map: { service: string }): boolean;
}

const materializers = new Map<string, ReplayMaterializer>();

/** Registry seam for later Spotify/Apple/Tidal playback materializers. */
export function registerReplayMaterializer(materializer: ReplayMaterializer): () => void {
  materializers.set(materializer.service, materializer);
  return () => materializers.delete(materializer.service);
}

export function getReplayMaterializer(service: string): ReplayMaterializer | undefined {
  return materializers.get(service);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toProgress(job: ReplayResolutionJob): ReplayResolutionProgress {
  return {
    id: job.id,
    replayId: job.replayId,
    status: job.status,
    total: job.total,
    processed: job.processed,
    resolved: job.resolved,
    missing: job.missing,
    failed: job.failed,
    committedOffset: job.committedOffset,
    error: job.error,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    failures: job.failures ?? [],
    // Default zeros; the REST endpoint computes the real breakdown from
    // serviceTrackMapTable so SSE events (emitJob) keep zero overhead.
    missBreakdown: { noVector: 0, noLinks: 0, noRecording: 0 },
  };
}

async function computeMissBreakdown(
  replayId: number,
): Promise<ReplayResolutionMissBreakdown> {
  const manifest = await getReplayManifest(replayId);
  const mbids = manifest?.entries.flatMap((e) =>
    e.recording?.mbid ? [e.recording.mbid] : [],
  ) ?? [];
  if (!mbids.length) return { noVector: 0, noLinks: 0, noRecording: 0 };

  // Exclude any MBID that now has at least one live exact positive mapping —
  // the sentinel may still exist on older rows written before the delete-on-
  // resolve fix landed, so we gate here as a safety net.
  const resolvedRows = await db
    .selectDistinct({ recordingMbid: serviceTrackMapTable.recordingMbid })
    .from(serviceTrackMapTable)
    .where(
      and(
        inArray(serviceTrackMapTable.recordingMbid, mbids),
        isNotNull(serviceTrackMapTable.url),
        eq(serviceTrackMapTable.deadLink, false),
        isNull(serviceTrackMapTable.missReason),
      ),
    );
  const resolvedSet = new Set(resolvedRows.map((r) => r.recordingMbid));
  const unresolvedMbids = mbids.filter((m) => !resolvedSet.has(m));
  if (!unresolvedMbids.length) return { noVector: 0, noLinks: 0, noRecording: 0 };

  const rows = await db
    .select({
      missReason: serviceTrackMapTable.missReason,
      count: sql<number>`count(*)::int`,
    })
    .from(serviceTrackMapTable)
    .where(
      and(
        inArray(serviceTrackMapTable.recordingMbid, unresolvedMbids),
        eq(serviceTrackMapTable.service, "odesli"),
        isNotNull(serviceTrackMapTable.missReason),
      ),
    )
    .groupBy(serviceTrackMapTable.missReason);

  const breakdown: ReplayResolutionMissBreakdown = { noVector: 0, noLinks: 0, noRecording: 0 };
  for (const row of rows) {
    if (row.missReason === "no_vector") breakdown.noVector = row.count;
    else if (row.missReason === "no_links") breakdown.noLinks = row.count;
    else if (row.missReason === "no_recording") breakdown.noRecording = row.count;
  }
  return breakdown;
}
async function emitJob(jobId: number): Promise<void> {
  const [job] = await db
    .select()
    .from(replayResolutionJobsTable)
    .where(eq(replayResolutionJobsTable.id, jobId))
    .limit(1);
  if (job) replayResolutionEvents.emit("progress", toProgress(job));
}

export async function getReplayResolutionJob(
  jobId: number,
  userId: number,
): Promise<ReplayResolutionProgress | null> {
  const [job] = await db
    .select()
    .from(replayResolutionJobsTable)
    .where(
      and(
        eq(replayResolutionJobsTable.id, jobId),
        eq(replayResolutionJobsTable.userId, userId),
      ),
    )
    .limit(1);
  if (!job) return null;
  const missBreakdown = await computeMissBreakdown(job.replayId);
  return { ...toProgress(job), missBreakdown };
}

export async function startReplayResolutionJob(
  userId: number,
  replayId: number,
): Promise<ReplayResolutionProgress | null> {
  const manifest = await getReplayManifest(replayId);
  if (!manifest) return null;

  // Reuse a non-terminal request for the same user/run rather than making
  // reconnects or double-clicks create competing Odesli work.
  const [existing] = await db
    .select()
    .from(replayResolutionJobsTable)
    .where(
      and(
        eq(replayResolutionJobsTable.userId, userId),
        eq(replayResolutionJobsTable.replayId, replayId),
        inArray(replayResolutionJobsTable.status, ["pending", "running"]),
      ),
    )
    .orderBy(asc(replayResolutionJobsTable.id))
    .limit(1);
  if (existing) {
    void runReplayResolutionWorker(existing.id);
    return toProgress(existing);
  }

  const [job] = await db
    .insert(replayResolutionJobsTable)
    .values({ userId, replayId, total: manifest.entries.length })
    .returning();
  if (!job) return null;
  void runReplayResolutionWorker(job.id);
  return toProgress(job);
}

type OdesliEntity = {
  id?: string;
  apiProvider?: string;
};
type OdesliBody = {
  linksByPlatform?: Record<string, { url?: string }>;
  entitiesByUniqueId?: Record<string, OdesliEntity>;
};

const SERVICE_NAMES: Record<string, string> = {
  spotify: "spotify",
  appleMusic: "apple_music",
  bandcamp: "bandcamp",
  youtube: "youtube",
  youtubeMusic: "youtube_music",
  tidal: "tidal",
  amazonMusic: "amazon_music",
  deezer: "deezer",
  soundcloud: "soundcloud",
  pandora: "pandora",
};

export function canonicalReplayService(key: string): string {
  return SERVICE_NAMES[key] ?? key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function serviceId(url: string, service: string, body: OdesliBody): string | null {
  const entity = Object.values(body.entitiesByUniqueId ?? {}).find(
    (candidate) => canonicalReplayService(candidate.apiProvider ?? "") === service,
  );
  if (entity?.id?.trim()) return entity.id.trim();
  try {
    const parsed = new URL(url);
    const part = parsed.pathname.split("/").filter(Boolean).at(-1);
    return part?.trim() || null;
  } catch {
    return null;
  }
}

function existingExactOdesliVector(
  links: Array<{ name: string; url: string }> | null,
): string | null {
  const spotify = links?.find((link) => /spotify\.com\/track\//i.test(link.url));
  if (spotify) return spotify.url;
  return null;
}

async function serializedOdesli(vector: string): Promise<unknown> {
  const run = odesliJobChain.then(async () => {
    await sleep(ODESLI_JOB_GAP_MS);
    return fetchOdesli(vector);
  });
  odesliJobChain = run.catch(() => undefined);
  return run;
}

function mapRank(method: string, confidence: string): number {
  if (method === "recording_id" || method === "isrc") return 40;
  if (method === "odesli" && confidence === "exact") return 30;
  return 10;
}

/**
 * Safe map upsert: a stronger existing mapping never loses its confidence,
 * dead links are revived only by a successful exact resolution, and the one
 * row per recording/service invariant is preserved.
 */
export async function upsertServiceTrackMap(input: {
  recordingMbid: string;
  service: string;
  externalId: string | null;
  url: string;
  method: string;
  confidence: "exact" | "search";
  verification: "verified" | "unverified";
}): Promise<void> {
  const [existing] = await db
    .select()
    .from(serviceTrackMapTable)
    .where(
      and(
        eq(serviceTrackMapTable.recordingMbid, input.recordingMbid),
        eq(serviceTrackMapTable.service, input.service),
      ),
    )
    .limit(1);
  if (
    existing &&
    mapRank(existing.method, existing.confidence) > mapRank(input.method, input.confidence)
  ) return;

  await db
    .insert(serviceTrackMapTable)
    .values({
      ...input,
      deadLink: false,
      deadAt: null,
      lastVerifiedAt: input.verification === "verified" ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: [serviceTrackMapTable.recordingMbid, serviceTrackMapTable.service],
      set: {
        externalId: input.externalId,
        url: input.url,
        method: input.method,
        confidence: input.confidence,
        verification: input.verification,
        deadLink: false,
        deadAt: null,
        lastVerifiedAt: input.verification === "verified" ? new Date() : sql`${serviceTrackMapTable.lastVerifiedAt}`,
        // Clear any stale negative-cache fields when a positive hit arrives.
        missReason: null,
        missedAt: null,
        updatedAt: sql`now()`,
      },
    });

  // A positive service link means the track resolved — delete the odesli
  // embed-miss sentinel so it no longer appears in missBreakdown.
  await db
    .delete(serviceTrackMapTable)
    .where(
      and(
        eq(serviceTrackMapTable.recordingMbid, input.recordingMbid),
        eq(serviceTrackMapTable.service, "odesli"),
        isNotNull(serviceTrackMapTable.missReason),
      ),
    );
}

/** 30-day TTL before a hopeless MBID is retried via Odesli. */
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 1-hour TTL for transient network errors — retry sooner than a real miss. */
const NETWORK_ERROR_MISS_TTL_MS = 1 * 60 * 60 * 1000;
/**
 * Write (or refresh) an embed_miss row for a recording that has no resolvable
 * link on any service.  Uses service="odesli" as a sentinel — it is never a
 * real playback service so there is no conflict with positive-hit rows.
 *
 * reason values: "no_vector" | "no_links" | "no_recording" | "network_error"
 */
export async function upsertServiceTrackMapMiss(
  recordingMbid: string,
  reason: string,
): Promise<void> {
  await db
    .insert(serviceTrackMapTable)
    .values({
      recordingMbid,
      service: "odesli",
      url: null,
      method: "odesli",
      confidence: "search",
      verification: "unverified",
      deadLink: false,
      missReason: reason,
      missedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [serviceTrackMapTable.recordingMbid, serviceTrackMapTable.service],
      set: {
        missReason: reason,
        missedAt: new Date(),
        updatedAt: sql`now()`,
      },
    });
}

export async function markServiceTrackMapDead(
  recordingMbid: string,
  service: string,
): Promise<void> {
  await db
    .update(serviceTrackMapTable)
    .set({ deadLink: true, deadAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(serviceTrackMapTable.recordingMbid, recordingMbid),
        eq(serviceTrackMapTable.service, service),
      ),
    );
}

export async function resolveRecording(
  mbid: string,
  recording: { title: string; artist: string; isrc: string | null; links: Array<{ name: string; url: string; kind: "exact" | "search" }> | null },
): Promise<"resolved" | "missing"> {
  // Short-circuit if an exact hit already exists — nothing to do.
  const [existing] = await db
    .select({ id: serviceTrackMapTable.id })
    .from(serviceTrackMapTable)
    .where(
      and(
        eq(serviceTrackMapTable.recordingMbid, mbid),
        eq(serviceTrackMapTable.deadLink, false),
        eq(serviceTrackMapTable.confidence, "exact"),
        isNull(serviceTrackMapTable.missReason),
      ),
    )
    .limit(1);
  if (existing) return "resolved";

  // Short-circuit if a recent negative-cache row exists.  The sentinel row
  // uses service="odesli" and records the reason and timestamp so the resolver
  // can skip hopeless MBIDs without burning Odesli rate-limit.
  // TTL varies by reason: network errors use a 1-hour window; all other misses
  // use the standard 30-day window.
  const [existingMiss] = await db
    .select({
      id: serviceTrackMapTable.id,
      missReason: serviceTrackMapTable.missReason,
      missedAt: serviceTrackMapTable.missedAt,
    })
    .from(serviceTrackMapTable)
    .where(
      and(
        eq(serviceTrackMapTable.recordingMbid, mbid),
        eq(serviceTrackMapTable.service, "odesli"),
        isNotNull(serviceTrackMapTable.missReason),
      ),
    )
    .limit(1);
  if (existingMiss?.missedAt) {
    const ttl =
      existingMiss.missReason === "network_error"
        ? NETWORK_ERROR_MISS_TTL_MS
        : MISS_TTL_MS;
    if (existingMiss.missedAt > new Date(Date.now() - ttl)) return "missing";
  }

  const vector = recording.isrc
    ? `isrc:${recording.isrc}`
    : existingExactOdesliVector(recording.links);
  if (!vector) {
    // Record the fact that there is nothing to query — saves a future Odesli call.
    await upsertServiceTrackMapMiss(mbid, "no_vector");
    return "missing";
  }

  let body: OdesliBody;
  try {
    body = (await serializedOdesli(vector)) as OdesliBody;
  } catch {
    // Network error (timeout, DNS failure, etc.) — write a short-lived miss row
    // so the next run skips this MBID for an hour instead of burning rate-limit.
    await upsertServiceTrackMapMiss(mbid, "network_error");
    return "missing";
  }
  const links = Object.entries(body.linksByPlatform ?? {})
      .map(([platform, value]) => ({ service: canonicalReplayService(platform), url: value.url?.trim() ?? "" }))
    .filter((link) => link.url);
  if (!links.length) {
    // Odesli returned nothing — record the miss so we don't retry for 30 days.
    await upsertServiceTrackMapMiss(mbid, "no_links");
    return "missing";
  }

  await Promise.all(
    links.map((link) =>
      upsertServiceTrackMap({
        recordingMbid: mbid,
        service: link.service,
        externalId: serviceId(link.url, link.service, body),
        url: link.url,
        method: "odesli",
        confidence: "exact",
        verification: "verified",
      }),
    ),
  );
  return "resolved";
}

export async function runReplayResolutionWorker(jobId: number): Promise<void> {
  if (activeWorkers.has(jobId)) return;
  activeWorkers.add(jobId);
  try {
    const [job] = await db
      .select()
      .from(replayResolutionJobsTable)
      .where(eq(replayResolutionJobsTable.id, jobId))
      .limit(1);
    if (!job || job.status === "done" || job.status === "error") return;
    const manifest = await getReplayManifest(job.replayId);
    if (!manifest) {
      await db.update(replayResolutionJobsTable)
        .set({ status: "error", error: "Replay manifest no longer exists", finishedAt: new Date() })
        .where(eq(replayResolutionJobsTable.id, jobId));
      await emitJob(jobId);
      return;
    }

    await db.update(replayResolutionJobsTable)
      .set({ status: "running", total: manifest.entries.length })
      .where(eq(replayResolutionJobsTable.id, jobId));
    await emitJob(jobId);

    let current = job;
    for (let position = job.committedOffset; position < manifest.entries.length; position++) {
      const entry = manifest.entries[position]!;
      let outcome: "resolved" | "missing" | "failed" = "missing";
      let failure: ReplayResolutionFailure | null = null;
      try {
        const mbid = entry.recording?.mbid;
        if (!mbid) {
          outcome = "missing";
        } else {
          const [recording] = await db
            .select({
              title: recordingsTable.title,
              artist: recordingsTable.artist,
              isrc: recordingsTable.isrc,
              links: recordingsTable.links,
            })
            .from(recordingsTable)
            .where(eq(recordingsTable.mbid, mbid))
            .limit(1);
          if (recording) {
            outcome = await resolveRecording(mbid, recording);
          } else {
            // MBID is present but not in the recordings table — record the miss
            // so the resolver does not waste an Odesli call on the same MBID.
            await upsertServiceTrackMapMiss(mbid, "no_recording");
            outcome = "missing";
          }
        }
      } catch (err) {
        outcome = "failed";
        failure = {
          position,
          spinId: entry.spinId,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      const failures = failure
        ? [...(current.failures ?? []), failure].slice(-FAILURE_CAP)
        : current.failures ?? [];
      const [updated] = await db
        .update(replayResolutionJobsTable)
        .set({
          processed: current.processed + 1,
          resolved: current.resolved + (outcome === "resolved" ? 1 : 0),
          missing: current.missing + (outcome === "missing" ? 1 : 0),
          failed: current.failed + (outcome === "failed" ? 1 : 0),
          committedOffset: position + 1,
          failures,
        })
        .where(eq(replayResolutionJobsTable.id, jobId))
        .returning();
      current = updated ?? current;
      await emitJob(jobId);
    }

    await db.update(replayResolutionJobsTable)
      .set({ status: "done", finishedAt: new Date() })
      .where(eq(replayResolutionJobsTable.id, jobId));
    await emitJob(jobId);
  } catch (err) {
    await db.update(replayResolutionJobsTable)
      .set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      })
      .where(eq(replayResolutionJobsTable.id, jobId))
      .catch(() => undefined);
    await emitJob(jobId).catch(() => undefined);
  } finally {
    activeWorkers.delete(jobId);
  }
}

/** Restart-safe continuation for every persisted non-terminal job. */
export async function resumeReplayResolutionJobs(): Promise<void> {
  const jobs = await db
    .select({ id: replayResolutionJobsTable.id })
    .from(replayResolutionJobsTable)
    .where(inArray(replayResolutionJobsTable.status, ["pending", "running"]));
  for (const job of jobs) setImmediate(() => void runReplayResolutionWorker(job.id));
}
