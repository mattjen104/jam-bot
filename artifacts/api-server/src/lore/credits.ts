import {
  creditEnrichmentQueueTable,
  db,
  libraryItemsTable,
  musicbrainzLabelsTable,
  musicbrainzReleasesTable,
  musicbrainzWorksTable,
  recordingCreditsTable,
  recordingWorksTable,
  releaseLabelsTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import {
  creditRoleGroup,
  fetchRecordingCreditsWithStatus,
  logger,
  type RecordingCredits,
} from "@workspace/song-enrichment";
import { safeFailureMessage } from "./safe-error.js";

const WORKER_INTERVAL_MS = 30_000;
const MAX_PER_PASS = 4;
const PARSER_VERSION = "credits-v2";
const MUSICBRAINZ_RATE_LOCK = "lore:musicbrainz:credits-rate";
const MUSICBRAINZ_PROVENANCE = {
  source: "musicbrainz",
  parserVersion: PARSER_VERSION,
};
export const CREDIT_RETRY_BATCH_MAX = 20;
const STALE_RUNNING_MS = 15 * 60_000;

export interface CreditEnrichmentHealth {
  counts: {
    pending: number;
    running: number;
    deferred: number;
    unavailable: number;
    partial: number;
  };
  oldestBacklogAt: string | null;
  oldestBacklogAgeMs: number | null;
  totalAttempts: number;
  maxAttempts: number;
  leaseHeld: boolean;
  recentErrors: Array<{
    recordingMbid: string;
    status: string;
    attempts: number;
    error: string;
    updatedAt: string;
  }>;
}

/** Enqueue only after a recording has entered an active Keep. */
export async function enqueueKeptCreditEnrichment(
  recordingMbid: string,
  priority = 0,
): Promise<void> {
  const mbid = recordingMbid.trim();
  if (!mbid) return;
  await db
    .insert(creditEnrichmentQueueTable)
    .values({
      recordingMbid: mbid,
      priority,
      status: "pending",
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: creditEnrichmentQueueTable.recordingMbid,
      set: {
        priority: sql`LEAST(${creditEnrichmentQueueTable.priority}, ${priority})`,
        status: "pending",
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
        lastError: null,
      },
    });
}

function creditKey(
  recordingMbid: string,
  workMbid: string | null,
  role: string,
  name: string,
  artistMbid?: string,
): string {
  return [recordingMbid, workMbid ?? "", role, name.toLocaleLowerCase(), artistMbid ?? ""]
    .join("\u001f");
}

/** Persist one fetched payload without collapsing distinct works/releases. */
export async function persistRecordingCredits(
  credits: RecordingCredits,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    if (credits.status === "complete") {
      // A complete provider answer is authoritative for this recording. A
      // partial answer intentionally leaves old facts in place rather than
      // turning a provider outage into a false "no credits" result.
      await tx
        .delete(recordingCreditsTable)
        .where(eq(recordingCreditsTable.recordingMbid, credits.recordingId));
    }
    for (const work of credits.works ?? []) {
      await tx
        .insert(musicbrainzWorksTable)
        .values({
          mbid: work.id,
          title: work.title ?? null,
          parserVersion: PARSER_VERSION,
          provenance: MUSICBRAINZ_PROVENANCE,
          completeness: credits.status === "complete" ? "complete" : "partial",
          fetchedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: musicbrainzWorksTable.mbid,
          set: {
            title: work.title ?? null,
            parserVersion: PARSER_VERSION,
            provenance: MUSICBRAINZ_PROVENANCE,
            completeness: credits.status === "complete" ? "complete" : "partial",
            fetchedAt: now,
            updatedAt: now,
          },
        });
    }
    for (const [position, workMbid] of credits.workIds.entries()) {
      await tx
        .insert(recordingWorksTable)
        .values({
          recordingMbid: credits.recordingId,
          workMbid,
          position,
          provenance: { source: "musicbrainz", parserVersion: PARSER_VERSION },
        })
        .onConflictDoUpdate({
          target: [recordingWorksTable.recordingMbid, recordingWorksTable.workMbid],
          set: { position, provenance: { source: "musicbrainz", parserVersion: PARSER_VERSION } },
        });
    }
    const workCreditKeys = new Set(
      (credits.workPersonnel ?? []).flatMap((group) =>
        group.credits.map((person) =>
          creditKey(credits.recordingId, null, person.role, person.name, person.artistId),
        ),
      ),
    );
    const persistCredit = async (
      person: { role: string; name: string; artistId?: string; artistKind?: "person" | "group" },
      workMbid: string | null,
    ) => {
      const key = creditKey(
        credits.recordingId,
        workMbid,
        person.role,
        person.name,
        person.artistId,
      );
      await tx
        .insert(recordingCreditsTable)
        .values({
          creditKey: key,
          recordingMbid: credits.recordingId,
          workMbid,
          artistMbid: person.artistId ?? null,
          artistKind: person.artistKind ?? null,
          creditedName: person.name,
          role: person.role,
          roleGroup: creditRoleGroup(person.role),
          completeness: credits.status === "complete" ? "complete" : "partial",
          attemptStatus: credits.status ?? "partial",
          parserVersion: PARSER_VERSION,
          sourceUrl: credits.sourceUrl ?? `https://musicbrainz.org/recording/${credits.recordingId}`,
          provenance: credits.provenance ?? MUSICBRAINZ_PROVENANCE,
          fetchedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: recordingCreditsTable.creditKey,
          set: {
            creditedName: person.name,
            artistMbid: person.artistId ?? null,
            artistKind: person.artistKind ?? null,
            role: person.role,
            roleGroup: creditRoleGroup(person.role),
            source: "musicbrainz",
            sourceUrl: credits.sourceUrl ?? `https://musicbrainz.org/recording/${credits.recordingId}`,
            completeness: credits.status === "complete" ? "complete" : "partial",
            attemptStatus: credits.status ?? "partial",
            parserVersion: PARSER_VERSION,
            provenance: credits.provenance ?? MUSICBRAINZ_PROVENANCE,
            fetchedAt: now,
            updatedAt: now,
          },
        });
    };
    for (const person of credits.personnel) {
      if (!workCreditKeys.has(creditKey(
        credits.recordingId,
        null,
        person.role,
        person.name,
        person.artistId,
      ))) {
        await persistCredit(person, null);
      }
    }
    for (const group of credits.workPersonnel ?? []) {
      for (const person of group.credits) await persistCredit(person, group.workId);
    }
    for (const release of credits.releases ?? []) {
      await tx
        .insert(musicbrainzReleasesTable)
        .values({
          mbid: release.releaseId,
          releaseGroupMbid: release.releaseGroupId ?? null,
          title: release.title ?? null,
          parserVersion: PARSER_VERSION,
          provenance: MUSICBRAINZ_PROVENANCE,
          releaseDate: release.date ?? null,
          status: release.status ?? null,
          country: release.country ?? null,
          completeness: credits.status === "complete" ? "complete" : "partial",
          fetchedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: musicbrainzReleasesTable.mbid,
          set: {
            releaseGroupMbid: release.releaseGroupId ?? null,
            title: release.title ?? null,
            parserVersion: PARSER_VERSION,
            provenance: MUSICBRAINZ_PROVENANCE,
            releaseDate: release.date ?? null,
            status: release.status ?? null,
            country: release.country ?? null,
            completeness: credits.status === "complete" ? "complete" : "partial",
            fetchedAt: now,
            updatedAt: now,
          },
        });
      for (const label of release.labels) {
        await tx
          .insert(musicbrainzLabelsTable)
          .values({
            mbid: label.labelId,
            name: label.name ?? null,
            fetchedAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: musicbrainzLabelsTable.mbid,
            set: { name: label.name ?? null, fetchedAt: now, updatedAt: now },
          });
        await tx
          .insert(releaseLabelsTable)
          .values({
            releaseMbid: release.releaseId,
            labelMbid: label.labelId,
            labelName: label.name ?? null,
            catalogNumber: label.catalogNumber ?? null,
            fetchedAt: now,
            parserVersion: PARSER_VERSION,
            updatedAt: now,
            provenance: { source: "musicbrainz", parserVersion: PARSER_VERSION },
          })
          .onConflictDoUpdate({
            target: [releaseLabelsTable.releaseMbid, releaseLabelsTable.labelMbid],
            set: {
              labelName: label.name ?? null,
              catalogNumber: sql`coalesce(excluded.catalog_number, ${releaseLabelsTable.catalogNumber})`,
              fetchedAt: now,
              parserVersion: PARSER_VERSION,
              updatedAt: now,
              provenance: { source: "musicbrainz", parserVersion: PARSER_VERSION },
            },
          });
      }
    }
  });
}

async function processOne(recordingMbid: string, attempts: number): Promise<void> {
  const [activeKeep] = await db
    .select({ id: libraryItemsTable.id })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.mbid, recordingMbid), isNull(libraryItemsTable.removedAt)))
    .limit(1);
  if (!activeKeep) {
    await db
      .update(creditEnrichmentQueueTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(creditEnrichmentQueueTable.recordingMbid, recordingMbid));
    return;
  }
  try {
    const result = await withMusicBrainzRateLease(() =>
      fetchRecordingCreditsWithStatus(recordingMbid),
    );
    if (result.status === "unavailable") {
      await db
        .update(creditEnrichmentQueueTable)
        .set({
          status: "unavailable",
          completedAt: new Date(),
          lastError: "MusicBrainz has no recording credit payload",
          updatedAt: new Date(),
        })
        .where(eq(creditEnrichmentQueueTable.recordingMbid, recordingMbid));
      return;
    }
    if (result.status === "deferred") {
      await db
        .update(creditEnrichmentQueueTable)
        .set({
          status: "deferred",
          nextAttemptAt: new Date(Date.now() + 5 * 60_000),
          lastError: "MusicBrainz unavailable or recording not found",
          updatedAt: new Date(),
        })
        .where(eq(creditEnrichmentQueueTable.recordingMbid, recordingMbid));
      return;
    }
    await persistRecordingCredits(result.credits);
    await db
      .update(creditEnrichmentQueueTable)
      .set({
        status: result.credits.status === "partial" ? "partial" : "complete",
        completedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(creditEnrichmentQueueTable.recordingMbid, recordingMbid));
  } catch (error) {
    await db
      .update(creditEnrichmentQueueTable)
      .set({
        status: "deferred",
        nextAttemptAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000),
        lastError: safeFailureMessage(error).slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(creditEnrichmentQueueTable.recordingMbid, recordingMbid));
  }
}

/**
 * Serialize provider starts across API processes. The advisory lock is
 * transaction-scoped and the transaction owns no application row locks while
 * the network call runs. Holding it for the enrichment keeps the source-wide
 * spacing guarantee even when one enrichment fans out to linked works.
 */
export async function withMusicBrainzRateLease<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${MUSICBRAINZ_RATE_LOCK}))`,
    );
    await tx.execute(sql`select pg_sleep(1)`);
    return operation();
  });
}

/**
 * Seed only canonical recording identities from library_items. Provider rows
 * such as apple_library_items intentionally never enter this query: Apple
 * catalog IDs are playability references, not MusicBrainz recording IDs.
 */
export async function seedCreditEnrichmentQueue(limit = MAX_PER_PASS): Promise<void> {
  // Imports and older explicit keeps predate the queue. Select a bounded
  // newest-first page of missing active keeps; the anti-join advances on each
  // tick, so already-enqueued rows cannot starve older legacy rows. Explicit
  // keeps already have a priority-0 row; legacy rows use deterministic
  // priorities by newest addedAt.
  const batchLimit = Math.max(0, limit);
  if (batchLimit === 0) return;
  const newestAddedAt = sql<Date>`max(${libraryItemsTable.addedAt})`;
  const libraryRows = await db
    .select({
      recordingMbid: libraryItemsTable.mbid,
    })
    .from(libraryItemsTable)
    .leftJoin(
      creditEnrichmentQueueTable,
      eq(creditEnrichmentQueueTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(
      and(
        isNull(libraryItemsTable.removedAt),
        isNull(creditEnrichmentQueueTable.recordingMbid),
      ),
    )
    .groupBy(libraryItemsTable.mbid)
    .orderBy(desc(newestAddedAt), asc(libraryItemsTable.mbid))
    .limit(batchLimit);
  if (!libraryRows.length) return;
  const now = new Date();
  await db
    .insert(creditEnrichmentQueueTable)
    .values(
      libraryRows.map((row, index) => ({
        recordingMbid: row.recordingMbid,
        priority: 50 + index,
        status: "pending",
        nextAttemptAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
}

export async function claimCreditEnrichmentRows(limit = MAX_PER_PASS): Promise<Array<{
  recordingMbid: string;
  attempts: number;
}>> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
    const rows = await tx
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        attempts: creditEnrichmentQueueTable.attempts,
      })
      .from(creditEnrichmentQueueTable)
      .where(
        and(
          or(
            eq(creditEnrichmentQueueTable.status, "pending"),
            eq(creditEnrichmentQueueTable.status, "deferred"),
            and(
              eq(creditEnrichmentQueueTable.status, "running"),
              lte(creditEnrichmentQueueTable.lastAttemptAt, staleBefore),
            ),
          ),
          lte(creditEnrichmentQueueTable.nextAttemptAt, now),
        ),
      )
      .orderBy(
        asc(creditEnrichmentQueueTable.priority),
        asc(creditEnrichmentQueueTable.nextAttemptAt),
        asc(creditEnrichmentQueueTable.recordingMbid),
      )
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!rows.length) return [];
    const claimed: Array<{ recordingMbid: string; attempts: number }> = [];
    for (const row of rows) {
      const attempts = row.attempts + 1;
      const [updated] = await tx
        .update(creditEnrichmentQueueTable)
        .set({
          status: "running",
          attempts,
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(creditEnrichmentQueueTable.recordingMbid, row.recordingMbid))
        .returning({ recordingMbid: creditEnrichmentQueueTable.recordingMbid });
      if (updated) claimed.push({ recordingMbid: updated.recordingMbid, attempts });
    }
    return claimed;
  });
}

function retryableCreditQueueCondition(now: Date) {
  const staleBefore = new Date(now.getTime() - STALE_RUNNING_MS);
  return or(
    eq(creditEnrichmentQueueTable.status, "deferred"),
    eq(creditEnrichmentQueueTable.status, "unavailable"),
    eq(creditEnrichmentQueueTable.status, "partial"),
    and(
      eq(creditEnrichmentQueueTable.status, "running"),
      lte(creditEnrichmentQueueTable.lastAttemptAt, staleBefore),
    ),
  );
}

/** Reset one failed/stale row. The normal worker owns the provider call and lease. */
export async function retryCreditEnrichmentRecording(recordingMbid: string): Promise<boolean> {
  const mbid = recordingMbid.trim();
  if (!mbid) return false;
  const now = new Date();
  const rows = await db
    .update(creditEnrichmentQueueTable)
    .set({
      status: "pending",
      nextAttemptAt: now,
      completedAt: null,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(creditEnrichmentQueueTable.recordingMbid, mbid),
        retryableCreditQueueCondition(now),
      ),
    )
    .returning({ recordingMbid: creditEnrichmentQueueTable.recordingMbid });
  return rows.length === 1;
}

/** Reset at most CREDIT_RETRY_BATCH_MAX rows, without running provider work inline. */
export async function retryCreditEnrichmentBatch(
  requestedLimit = CREDIT_RETRY_BATCH_MAX,
): Promise<string[]> {
  const limit = Math.max(1, Math.min(CREDIT_RETRY_BATCH_MAX, Math.floor(requestedLimit)));
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .select({ recordingMbid: creditEnrichmentQueueTable.recordingMbid })
      .from(creditEnrichmentQueueTable)
      .where(retryableCreditQueueCondition(now))
      .orderBy(
        desc(creditEnrichmentQueueTable.attempts),
        asc(creditEnrichmentQueueTable.updatedAt),
        asc(creditEnrichmentQueueTable.recordingMbid),
      )
      .limit(limit)
      .for("update", { skipLocked: true });
    if (!rows.length) return [];
    const mbids = rows.map((row) => row.recordingMbid);
    await tx.execute(sql`
      update ${creditEnrichmentQueueTable}
      set status = 'pending',
          next_attempt_at = ${now},
          completed_at = null,
          last_error = null,
          updated_at = ${now}
      where recording_mbid in (${sql.join(mbids.map((mbid) => sql`${mbid}`), sql`, `)})
    `);
    return mbids;
  });
}

export async function getCreditEnrichmentHealth(): Promise<CreditEnrichmentHealth> {
  const [summaryResult, errors, leaseResult] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where status = 'pending')::int as pending,
        count(*) filter (where status = 'running')::int as running,
        count(*) filter (where status = 'deferred')::int as deferred,
        count(*) filter (where status = 'unavailable')::int as unavailable,
        count(*) filter (where status = 'partial')::int as partial,
        min(created_at) filter (
          where status in ('pending', 'running', 'deferred')
        ) as oldest_backlog_at,
        coalesce(sum(attempts), 0)::int as total_attempts,
        coalesce(max(attempts), 0)::int as max_attempts
      from ${creditEnrichmentQueueTable}
    `),
    db
      .select({
        recordingMbid: creditEnrichmentQueueTable.recordingMbid,
        status: creditEnrichmentQueueTable.status,
        attempts: creditEnrichmentQueueTable.attempts,
        lastError: creditEnrichmentQueueTable.lastError,
        updatedAt: creditEnrichmentQueueTable.updatedAt,
      })
      .from(creditEnrichmentQueueTable)
      .where(sql`${creditEnrichmentQueueTable.lastError} is not null`)
      .orderBy(desc(creditEnrichmentQueueTable.updatedAt))
      .limit(8),
    db.execute(sql`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory'
          and objid = hashtext(${MUSICBRAINZ_RATE_LOCK})::oid
          and granted
      ) as held
    `),
  ]);
  const row = (summaryResult.rows[0] ?? {}) as Record<string, unknown>;
  const oldest = row["oldest_backlog_at"] instanceof Date
    ? row["oldest_backlog_at"]
    : row["oldest_backlog_at"]
      ? new Date(String(row["oldest_backlog_at"]))
      : null;
  const lease = (leaseResult.rows[0] ?? {}) as Record<string, unknown>;
  return {
    counts: {
      pending: Number(row["pending"] ?? 0),
      running: Number(row["running"] ?? 0),
      deferred: Number(row["deferred"] ?? 0),
      unavailable: Number(row["unavailable"] ?? 0),
      partial: Number(row["partial"] ?? 0),
    },
    oldestBacklogAt: oldest?.toISOString() ?? null,
    oldestBacklogAgeMs: oldest ? Math.max(0, Date.now() - oldest.getTime()) : null,
    totalAttempts: Number(row["total_attempts"] ?? 0),
    maxAttempts: Number(row["max_attempts"] ?? 0),
    leaseHeld: Boolean(lease["held"]),
    recentErrors: errors.map((error) => ({
      recordingMbid: error.recordingMbid,
      status: error.status,
      attempts: error.attempts,
      error: safeFailureMessage(error.lastError ?? "Unknown failure").slice(0, 500),
      updatedAt: error.updatedAt.toISOString(),
    })),
  };
}

export async function runCreditEnrichmentPass(limit = MAX_PER_PASS): Promise<void> {
  await seedCreditEnrichmentQueue(limit);
  const rows = await claimCreditEnrichmentRows(limit);
  // Keep provider calls sequential so the MusicBrainz client's global limiter
  // remains effective while claims are distributed across processes.
  for (const row of rows) await processOne(row.recordingMbid, row.attempts);
}

let workerStarted = false;
export function startCreditEnrichmentWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  const tick = async () => {
    try {
      await runCreditEnrichmentPass();
    } catch (error) {
      logger.warn("credit enrichment pass failed", error);
    }
    setTimeout(() => void tick(), WORKER_INTERVAL_MS);
  };
  setTimeout(() => void tick(), WORKER_INTERVAL_MS);
}