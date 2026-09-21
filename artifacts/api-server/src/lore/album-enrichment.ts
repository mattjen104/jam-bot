import {
  albumEnrichmentQueueTable,
  db,
  libraryItemsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { resolveReleaseMetadata } from "./release-metadata.js";
import { enqueueKeptCreditEnrichment } from "./credits.js";
import { logger } from "@workspace/song-enrichment";
import { runSpotifyReleaseGroupBackfill } from "./spotify-release-group-materializer.js";

const WORKER_INTERVAL_MS = 45_000;
const MAX_PER_PASS = 8;
const STALE_RUNNING_MS = 15 * 60_000;
const MISSING_CONFIG_RETRY_MS = 6 * 60 * 60_000;

export async function enqueueKeptAlbumEnrichment(
  recordingMbid: string,
  priority = 0,
): Promise<void> {
  const mbid = recordingMbid.trim();
  if (!mbid) return;
  await db.insert(albumEnrichmentQueueTable).values({
    recordingMbid: mbid,
    priority,
    status: "pending",
    nextAttemptAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: albumEnrichmentQueueTable.recordingMbid,
    set: {
      priority: sql`least(${albumEnrichmentQueueTable.priority}, ${priority})`,
      status: "pending",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
      lastError: null,
    },
  });
}

export interface AlbumEnrichmentHealth {
  counts: Record<string, number>;
  coverage: { active: number; resolved: number; unresolved: number };
  oldestBacklogAt: string | null;
  recentErrors: Array<{ recordingMbid: string; status: string; attempts: number; error: string }>;
}

export async function seedAlbumEnrichmentQueue(limit = MAX_PER_PASS): Promise<void> {
  if (limit <= 0) return;
  const rows = await db
    .select({ recordingMbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .leftJoin(
      albumEnrichmentQueueTable,
      eq(albumEnrichmentQueueTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(and(
      isNull(libraryItemsTable.removedAt),
      isNull(albumEnrichmentQueueTable.recordingMbid),
    ))
    .orderBy(desc(libraryItemsTable.addedAt), asc(libraryItemsTable.mbid))
    .limit(limit);
  if (!rows.length) return;
  const now = new Date();
  await db.insert(albumEnrichmentQueueTable).values(rows.map((row, index) => ({
    recordingMbid: row.recordingMbid,
    priority: 50 + index,
    status: "pending",
    nextAttemptAt: now,
    updatedAt: now,
  }))).onConflictDoNothing();
}

async function claim(limit: number): Promise<Array<{ recordingMbid: string; attempts: number }>> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const stale = new Date(now.getTime() - STALE_RUNNING_MS);
    const rows = await tx
      .select({
        recordingMbid: albumEnrichmentQueueTable.recordingMbid,
        attempts: albumEnrichmentQueueTable.attempts,
      })
      .from(albumEnrichmentQueueTable)
      .where(and(
        or(
          eq(albumEnrichmentQueueTable.status, "pending"),
          eq(albumEnrichmentQueueTable.status, "deferred"),
          and(eq(albumEnrichmentQueueTable.status, "running"), lte(albumEnrichmentQueueTable.lastAttemptAt, stale)),
        ),
        lte(albumEnrichmentQueueTable.nextAttemptAt, now),
      ))
      .orderBy(asc(albumEnrichmentQueueTable.priority), asc(albumEnrichmentQueueTable.nextAttemptAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    const claimed: Array<{ recordingMbid: string; attempts: number }> = [];
    for (const row of rows) {
      const attempts = row.attempts + 1;
      const [updated] = await tx.update(albumEnrichmentQueueTable).set({
        status: "running",
        attempts,
        lastAttemptAt: now,
        updatedAt: now,
      }).where(eq(albumEnrichmentQueueTable.recordingMbid, row.recordingMbid))
        .returning({ recordingMbid: albumEnrichmentQueueTable.recordingMbid });
      if (updated) claimed.push({ recordingMbid: updated.recordingMbid, attempts });
    }
    return claimed;
  });
}

async function processOne(recordingMbid: string, attempts: number): Promise<void> {
  const [active] = await db.select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.mbid, recordingMbid), isNull(libraryItemsTable.removedAt)))
    .limit(1);
  if (!active) {
    await db.update(albumEnrichmentQueueTable)
      .set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(albumEnrichmentQueueTable.recordingMbid, recordingMbid));
    return;
  }
  if (!process.env.MUSICBRAINZ_CONTACT?.trim()) {
    await db.update(albumEnrichmentQueueTable).set({
      status: "deferred",
      nextAttemptAt: new Date(Date.now() + MISSING_CONFIG_RETRY_MS),
      lastError: "MusicBrainz contact configuration is missing",
      updatedAt: new Date(),
    }).where(eq(albumEnrichmentQueueTable.recordingMbid, recordingMbid));
    return;
  }
  try {
    const result = await resolveReleaseMetadata(
      [recordingMbid],
      { throwOnTransientFailure: true },
    );
    const resolved = result[recordingMbid];
    const now = new Date();
    await enqueueKeptCreditEnrichment(recordingMbid, 25);
    await db.update(recordingsTable).set({
      releaseEnrichmentStatus: resolved ? "complete" : "no_result",
      releaseEnrichmentAttemptedAt: now,
      releaseEnrichmentError: null,
      releaseDateCheckedAt: resolved ? now : undefined,
      updatedAt: now,
    }).where(eq(recordingsTable.mbid, recordingMbid));
    await db.update(albumEnrichmentQueueTable).set({
      status: resolved ? "complete" : "no_result",
      completedAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(albumEnrichmentQueueTable.recordingMbid, recordingMbid));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(albumEnrichmentQueueTable).set({
      status: "deferred",
      nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
      lastError: message.slice(0, 500),
      updatedAt: new Date(),
    }).where(eq(albumEnrichmentQueueTable.recordingMbid, recordingMbid));
  }
}

export async function runAlbumEnrichmentPass(limit = MAX_PER_PASS): Promise<void> {
  await seedAlbumEnrichmentQueue(limit);
  for (const row of await claim(limit)) await processOne(row.recordingMbid, row.attempts);
}

export async function getAlbumEnrichmentHealth(): Promise<AlbumEnrichmentHealth> {
  const [counts, coverage, errors] = await Promise.all([
    db.execute(sql`select status, count(*)::int as count from ${albumEnrichmentQueueTable} group by status`),
    db.execute(sql`
      select count(*) filter (where li.removed_at is null)::int as active,
             count(*) filter (where li.removed_at is null and rrg.recording_mbid is not null)::int as resolved
      from ${libraryItemsTable} li
      left join ${recordingReleaseGroupsTable} rrg
        on rrg.recording_mbid = li.mbid and rrg.is_primary = true
    `),
    db.select({
      recordingMbid: albumEnrichmentQueueTable.recordingMbid,
      status: albumEnrichmentQueueTable.status,
      attempts: albumEnrichmentQueueTable.attempts,
      lastError: albumEnrichmentQueueTable.lastError,
    }).from(albumEnrichmentQueueTable)
      .where(sql`${albumEnrichmentQueueTable.lastError} is not null`)
      .orderBy(desc(albumEnrichmentQueueTable.updatedAt)).limit(8),
  ]);
  const countMap: Record<string, number> = {};
  for (const row of counts.rows as Array<{ status: string; count: number | string }>) countMap[row.status] = Number(row.count);
  const coverageRow = (coverage.rows[0] ?? {}) as { active?: number | string; resolved?: number | string };
  const active = Number(coverageRow.active ?? 0);
  const resolved = Number(coverageRow.resolved ?? 0);
  const [oldest] = await db.select({ value: albumEnrichmentQueueTable.createdAt })
    .from(albumEnrichmentQueueTable)
    .where(or(eq(albumEnrichmentQueueTable.status, "pending"), eq(albumEnrichmentQueueTable.status, "deferred")))
    .orderBy(asc(albumEnrichmentQueueTable.createdAt)).limit(1);
  return {
    counts: countMap,
    coverage: { active, resolved, unresolved: Math.max(0, active - resolved) },
    oldestBacklogAt: oldest?.value.toISOString() ?? null,
    recentErrors: errors.map((row) => ({
      recordingMbid: row.recordingMbid,
      status: row.status,
      attempts: row.attempts,
      error: (row.lastError ?? "Unknown failure").slice(0, 500),
    })),
  };
}

let workerStarted = false;
export function startAlbumEnrichmentWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    try { await runAlbumEnrichmentPass(); }
    catch (error) { logger.warn(`album enrichment pass failed: ${String(error)}`); }
    try { await runSpotifyReleaseGroupBackfill(); }
    catch (error) { logger.warn(`spotify album materialization pass failed: ${String(error)}`); }
    setTimeout(() => void tick(), WORKER_INTERVAL_MS);
  };
  setTimeout(() => void tick(), WORKER_INTERVAL_MS);
}