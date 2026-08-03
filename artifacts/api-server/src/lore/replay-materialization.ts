import {
  db,
  replayMaterializationJobsTable,
  serviceConnectionsTable,
  serviceTrackMapTable,
  type ReplayMaterializationReceipt,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { decryptToken, encryptToken } from "./tokenCrypto.js";
import { getConnector } from "./serviceConnector.js";
import { getReplayManifest } from "./replay.js";
import { refreshServiceToken } from "./serviceConnector.js";

const activeWorkers = new Set<number>();

export type ReplayMaterializationProgress = {
  id: number;
  replayId: number;
  service: string;
  status: string;
  total: number;
  processed: number;
  accepted: number;
  missing: number;
  rejected: number;
  retryable: number;
  name: string;
  description: string;
  playlistId: string | null;
  playlistUrl: string | null;
  error: string | null;
  errorRetryable: boolean;
  finishedAt: string | null;
  receipt: ReplayMaterializationReceipt[];
};

function toProgress(
  job: typeof replayMaterializationJobsTable.$inferSelect,
): ReplayMaterializationProgress {
  return {
    id: job.id,
    replayId: job.replayId,
    service: job.service,
    status: job.status,
    total: job.total,
    processed: job.processed,
    accepted: job.accepted,
    missing: job.missing,
    rejected: job.rejected,
    retryable: job.retryable,
    name: job.name,
    description: job.description,
    playlistId: job.playlistId,
    playlistUrl: job.playlistUrl,
    error: job.error,
    errorRetryable: job.errorRetryable,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    receipt: job.receipt ?? [],
  };
}

export function replayAttribution(input: {
  station: string;
  picker: string | null;
  date: string;
}): { name: string; description: string } {
  const picker = input.picker?.trim() || "the station";
  return {
    name: `${input.station} · ${input.picker?.trim() || "Ghost Replay"} · ${input.date}`,
    description: `As broadcast on ${input.station}, ${picker}'s set, ${input.date} — via Lore`,
  };
}

function isRetryableProviderStatus(message: string): boolean {
  return /\((408|425|429|5\d\d)\)/.test(message);
}

async function freshConnection(userId: number, service: string) {
  const [conn] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(and(eq(serviceConnectionsTable.userId, userId), eq(serviceConnectionsTable.service, service)))
    .limit(1);
  if (!conn || !conn.canWrite) return null;
  if (conn.expiresAt.getTime() > Date.now()) {
    return { conn, accessToken: decryptToken(conn.accessToken) };
  }
  try {
    const refreshed = await refreshServiceToken(decryptToken(conn.refreshToken), service);
    await db.update(serviceConnectionsTable).set({
      accessToken: encryptToken(refreshed.accessToken),
      expiresAt: refreshed.expiresAt,
      scopes: refreshed.scopes,
    }).where(eq(serviceConnectionsTable.id, conn.id));
    return { conn: { ...conn, expiresAt: refreshed.expiresAt }, accessToken: refreshed.accessToken };
  } catch {
    return null;
  }
}

export async function getReplayMaterializationJob(
  jobId: number,
  userId: number,
): Promise<ReplayMaterializationProgress | null> {
  const [job] = await db.select().from(replayMaterializationJobsTable).where(
    and(eq(replayMaterializationJobsTable.id, jobId), eq(replayMaterializationJobsTable.userId, userId)),
  ).limit(1);
  return job ? toProgress(job) : null;
}

export async function listReplayMaterializationTargets(userId: number): Promise<Array<{
  service: string;
  displayName: string;
  connected: boolean;
  canWrite: boolean;
  configured: boolean;
  authRequired: boolean;
}>> {
  const configured = ["apple_music", "tidal"].flatMap((service) => {
    const connector = getConnector(service);
    if (!connector || !connector.isConfigured()) return [];
    return [{
      service,
      displayName: connector.displayName,
      connected: false,
      canWrite: false,
      configured: true,
      authRequired: true,
    }];
  });
  const rows = await Promise.all(configured.map(async (target) => {
    const [conn] = await db.select({ canWrite: serviceConnectionsTable.canWrite })
      .from(serviceConnectionsTable)
      .where(and(eq(serviceConnectionsTable.userId, userId), eq(serviceConnectionsTable.service, target.service)))
      .limit(1);
    return { ...target, connected: Boolean(conn), canWrite: conn?.canWrite === true, authRequired: !conn };
  }));
  return rows;
}

export async function startReplayMaterializationJob(
  userId: number,
  replayId: number,
  service: string,
): Promise<ReplayMaterializationProgress | null> {
  const manifest = await getReplayManifest(replayId);
  const connector = getConnector(service);
  if (!manifest || !connector || !connector.isConfigured() || !connector.createPlaylist || !connector.addPlaylistTracks) {
    return null;
  }
  const attribution = replayAttribution({
    station: manifest.station.name,
    picker: manifest.picker?.name ?? manifest.show?.djName ?? null,
    date: manifest.bounds.date,
  });
  // The partial unique index on active jobs turns the concurrent double-click
  // race into an idempotent read of the first request's receipt.
  const [job] = await db.insert(replayMaterializationJobsTable).values({
    userId, replayId, service, total: manifest.entries.length,
    name: attribution.name, description: attribution.description, receipt: [],
  }).onConflictDoNothing({
    where: sql`${replayMaterializationJobsTable.status} IN ('pending', 'running')`,
  }).returning();
  if (!job) {
    const [active] = await db.select().from(replayMaterializationJobsTable).where(and(
      eq(replayMaterializationJobsTable.userId, userId),
      eq(replayMaterializationJobsTable.replayId, replayId),
      eq(replayMaterializationJobsTable.service, service),
      inArray(replayMaterializationJobsTable.status, ["pending", "running"]),
    )).orderBy(desc(replayMaterializationJobsTable.id)).limit(1);
    if (!active) return null;
    void runReplayMaterializationWorker(active.id);
    return toProgress(active);
  }
  void runReplayMaterializationWorker(job.id);
  return toProgress(job);
}

export async function runReplayMaterializationWorker(jobId: number): Promise<void> {
  if (activeWorkers.has(jobId)) return;
  activeWorkers.add(jobId);
  try {
    const [job] = await db.select().from(replayMaterializationJobsTable)
      .where(eq(replayMaterializationJobsTable.id, jobId)).limit(1);
    if (!job || job.status === "done" || job.status === "error") return;
    const connector = getConnector(job.service);
    const connection = await freshConnection(job.userId, job.service);
    const manifest = await getReplayManifest(job.replayId);
    if (!connector?.createPlaylist || !connector.addPlaylistTracks || !connection || !manifest) {
      const message = !connection
        ? `No writable ${job.service} connection is available`
        : "Replay manifest no longer exists";
      await db.update(replayMaterializationJobsTable).set({
        status: "error",
        error: message,
        errorRetryable: false,
        finishedAt: new Date(),
      }).where(eq(replayMaterializationJobsTable.id, jobId));
      return;
    }
    await db.update(replayMaterializationJobsTable).set({ status: "running" })
      .where(eq(replayMaterializationJobsTable.id, jobId));
    const created = await connector.createPlaylist(connection.accessToken, {
      name: job.name,
      description: job.description,
      externalUserId: connection.conn.externalUserId,
    });
    if (!created.ok || !created.playlistId) {
      await db.update(replayMaterializationJobsTable).set({
        status: "error",
        error: created.error ?? "Playlist creation failed",
        errorRetryable: created.retryable,
        finishedAt: new Date(),
      }).where(eq(replayMaterializationJobsTable.id, jobId));
      return;
    }

    const mbids = manifest.entries.flatMap((entry) => entry.recording?.mbid ? [entry.recording.mbid] : []);
    const maps = mbids.length ? await db.select().from(serviceTrackMapTable).where(and(
      eq(serviceTrackMapTable.service, job.service),
      inArray(serviceTrackMapTable.recordingMbid, mbids),
      eq(serviceTrackMapTable.deadLink, false),
      eq(serviceTrackMapTable.confidence, "exact"),
    )) : [];
    const mapByMbid = new Map(maps.map((map) => [map.recordingMbid, map]));
    const eligible = manifest.entries.flatMap((entry) => {
      const recording = entry.recording;
      const map = recording ? mapByMbid.get(recording.mbid) : undefined;
      return map && recording && map.url != null ? [{
        position: entry.position,
        recordingMbid: recording.mbid,
        externalId: map.externalId ?? "",
        url: map.url ?? "",
        title: recording.title,
        artist: recording.artist,
      }] : [];
    }).filter((track) => track.externalId.length > 0);
    const providerResults = await connector.addPlaylistTracks(connection.accessToken, created.playlistId, eligible);
    const providerByPosition = new Map(providerResults.map((result) => [result.position, result]));
    const receipt: ReplayMaterializationReceipt[] = manifest.entries.map((entry) => {
      const recording = entry.recording;
      const map = recording ? mapByMbid.get(recording.mbid) : undefined;
      const provider = providerByPosition.get(entry.position);
      if (provider) {
        return {
          position: entry.position, spinId: entry.spinId, mbid: recording?.mbid ?? null,
          title: recording?.title ?? entry.rawTitle, artist: recording?.artist ?? entry.rawArtist,
          status: provider.status, retryable: provider.retryable, ...(provider.error ? { error: provider.error } : {}),
        };
      }
      const error = !recording
        ? "Broadcast entry was unresolved"
        : !map || !map.externalId
          ? `No exact ${job.service} track mapping`
          : "Track was not accepted by the provider";
      return {
        position: entry.position, spinId: entry.spinId, mbid: recording?.mbid ?? null,
        title: recording?.title ?? entry.rawTitle, artist: recording?.artist ?? entry.rawArtist,
        status: "missing", retryable: false, error,
      };
    });
    await db.update(replayMaterializationJobsTable).set({
      status: "done",
      processed: receipt.length,
      accepted: receipt.filter((item) => item.status === "accepted").length,
      missing: receipt.filter((item) => item.status === "missing").length,
      rejected: receipt.filter((item) => item.status === "rejected").length,
      retryable: receipt.filter((item) => item.retryable).length,
      playlistId: created.playlistId,
      playlistUrl: created.playlistUrl ?? null,
      receipt,
      finishedAt: new Date(),
    }).where(eq(replayMaterializationJobsTable.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(replayMaterializationJobsTable).set({
      status: "error",
      error: message,
      errorRetryable: isRetryableProviderStatus(message),
      finishedAt: new Date(),
    }).where(eq(replayMaterializationJobsTable.id, jobId)).catch(() => undefined);
  } finally {
    activeWorkers.delete(jobId);
  }
}

/** Restart-safe continuation for jobs that were interrupted during a deploy. */
export async function resumeReplayMaterializationJobs(): Promise<void> {
  const jobs = await db.select({ id: replayMaterializationJobsTable.id })
    .from(replayMaterializationJobsTable)
    .where(inArray(replayMaterializationJobsTable.status, ["pending", "running"]));
  for (const job of jobs) setImmediate(() => void runReplayMaterializationWorker(job.id));
}
