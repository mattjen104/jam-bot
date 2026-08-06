/**
 * KEXP duration backfill — populates `recordings.duration_ms` for KEXP spins
 * whose recording row exists but has a null duration.
 *
 * Background: KEXP has ~429k spins (half the dataset) at 12% duration coverage
 * on MBID-resolved spins vs 80–97% for every other top-20 station.  Diagnosis
 * (prerequisites report) confirmed the recordings rows EXIST with null
 * duration_ms — the fix is a one-time MusicBrainz backfill, not a re-resolve.
 * 274 distinct recording MBIDs need backfilling, ≈5 min at 1 req/sec.
 *
 * Design:
 *  - Completion ledger (`migration_completions`) prevents re-running on restart.
 *  - Resumable: safe to kill mid-run and restart (idempotent DB writes).
 *  - Never writes a guessed/interpolated duration — leaves null if MB has none.
 *  - Does not touch `spins` rows; duration lives on `recordings`.
 *  - Respects MusicBrainz 1 req/sec limit via a ≥1.1s gate between requests.
 *  - Batches DB reads (BATCH_SIZE) but writes individually for fine-grained
 *    progress logging and to avoid long transactions.
 */

import { db } from "@workspace/db";
import { recordingsTable, spinsTable, stationsTable } from "@workspace/db";
import { sql, isNull, eq, and, inArray } from "drizzle-orm";

const MIGRATION_NAME = "kexpDurationBackfill_v1";
const MB_BASE = "https://musicbrainz.org/ws/2";
/** MusicBrainz requires ≥1 req/sec; 1100ms gives comfortable headroom. */
const MB_MIN_INTERVAL_MS = 1100;
/** How many MBIDs to fetch from the DB per batch (progress checkpoint). */
const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Rate-limit gate
// ---------------------------------------------------------------------------

let lastMbFetchAt = 0;

async function mbFetch(path: string): Promise<unknown> {
  const now = Date.now();
  const wait = MB_MIN_INTERVAL_MS - (now - lastMbFetchAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMbFetchAt = Date.now();

  const contact =
    process.env["MUSICBRAINZ_CONTACT"]?.trim() ??
    "https://tune-tribe.replit.app";
  const res = await fetch(`${MB_BASE}${path}`, {
    headers: { "User-Agent": `LoreBot/1.0 (+${contact})` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`MusicBrainz ${res.status} for ${path}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Duration extraction
// ---------------------------------------------------------------------------

/**
 * Returns the duration in ms from a plain recording response body, or null if
 * MusicBrainz does not report a length for this recording.
 */
function parseDurationMs(body: unknown): number | null {
  const b = body as { length?: number } | null;
  if (typeof b?.length === "number" && b.length > 0) return b.length;
  return null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface KexpDurationBackfillReport {
  skippedAlreadyDone: boolean;
  mbidsQueried: number;
  mbidsUpdated: number;
  mbidsNoLength: number;
  mbidsFailed: number;
}

/**
 * Runs the KEXP duration backfill once.  Subsequent calls are no-ops (guarded
 * by the completion ledger).
 *
 * @param _testMbids  Test-only override — limits scope to specific MBIDs.
 *                    Never pass in production.
 */
export async function runKexpDurationBackfill(
  _testMbids?: string[],
): Promise<KexpDurationBackfillReport> {
  // -------------------------------------------------------------------
  // 1. Completion ledger check — skip if already done
  // -------------------------------------------------------------------
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = ${MIGRATION_NAME} LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[kexp-backfill] already complete, skipping");
    return {
      skippedAlreadyDone: true,
      mbidsQueried: 0,
      mbidsUpdated: 0,
      mbidsNoLength: 0,
      mbidsFailed: 0,
    };
  }

  // -------------------------------------------------------------------
  // 2. Find KEXP station IDs
  // -------------------------------------------------------------------
  const kexpStations = await db
    .select({ id: stationsTable.id })
    .from(stationsTable)
    .where(sql`lower(${stationsTable.name}) like '%kexp%'`);

  if (kexpStations.length === 0) {
    console.warn("[kexp-backfill] no KEXP stations found — aborting");
    return {
      skippedAlreadyDone: false,
      mbidsQueried: 0,
      mbidsUpdated: 0,
      mbidsNoLength: 0,
      mbidsFailed: 0,
    };
  }
  const kexpIds = kexpStations.map((s) => s.id);

  // -------------------------------------------------------------------
  // 3. Collect distinct MBIDs needing backfill
  // -------------------------------------------------------------------
  let targetMbids: string[];
  if (_testMbids) {
    targetMbids = _testMbids;
  } else {
    const rows = await db
      .selectDistinct({ mbid: spinsTable.mbid })
      .from(spinsTable)
      .innerJoin(recordingsTable, eq(recordingsTable.mbid, spinsTable.mbid))
      .where(
        and(
          inArray(spinsTable.stationId, kexpIds),
          isNull(recordingsTable.durationMs),
          sql`${spinsTable.mbid} is not null`,
        ),
      );
    targetMbids = rows.map((r) => r.mbid!);
  }

  console.info(
    `[kexp-backfill] found ${targetMbids.length} recording MBIDs needing duration`,
  );

  // -------------------------------------------------------------------
  // 4. Fetch durations from MusicBrainz and update recordings
  // -------------------------------------------------------------------
  let mbidsUpdated = 0;
  let mbidsNoLength = 0;
  let mbidsFailed = 0;

  for (let batchStart = 0; batchStart < targetMbids.length; batchStart += BATCH_SIZE) {
    const batch = targetMbids.slice(batchStart, batchStart + BATCH_SIZE);
    console.info(
      `[kexp-backfill] batch ${Math.floor(batchStart / BATCH_SIZE) + 1} ` +
      `(${batchStart + 1}–${batchStart + batch.length} of ${targetMbids.length})`,
    );

    for (const mbid of batch) {
      try {
        const body = await mbFetch(`/recording/${encodeURIComponent(mbid)}?fmt=json`);
        const durationMs = parseDurationMs(body);

        if (durationMs !== null) {
          await db
            .update(recordingsTable)
            .set({
              durationMs,
              updatedAt: new Date(),
            })
            .where(eq(recordingsTable.mbid, mbid));
          mbidsUpdated++;
        } else {
          // MusicBrainz has no length for this recording — leave null.
          // Never write a guessed/interpolated value.
          mbidsNoLength++;
        }
      } catch (err) {
        mbidsFailed++;
        console.warn(`[kexp-backfill] failed for ${mbid}: ${String(err)}`);
      }
    }

    console.info(
      `[kexp-backfill] progress — updated: ${mbidsUpdated}, ` +
      `no-length: ${mbidsNoLength}, failed: ${mbidsFailed}`,
    );
  }

  // -------------------------------------------------------------------
  // 5. Record completion in the ledger — only when fully successful
  //
  // If any individual MBID fetch failed, do NOT write the ledger row.
  // The next invocation will re-query recordings with null duration_ms
  // and retry only the MBIDs that are still missing — making the job
  // naturally resumable without needing an explicit retry list.
  // -------------------------------------------------------------------
  if (mbidsFailed === 0) {
    await db.execute(
      sql`INSERT INTO migration_completions (name) VALUES (${MIGRATION_NAME})
          ON CONFLICT (name) DO NOTHING`,
    );
    console.info(
      `[kexp-backfill] done — ` +
      `updated: ${mbidsUpdated}, no-length: ${mbidsNoLength}`,
    );
  } else {
    console.warn(
      `[kexp-backfill] partial run — ` +
      `updated: ${mbidsUpdated}, no-length: ${mbidsNoLength}, failed: ${mbidsFailed}. ` +
      `Re-run to retry the failed MBIDs (completion ledger NOT written).`,
    );
  }

  return {
    skippedAlreadyDone: false,
    mbidsQueried: targetMbids.length,
    mbidsUpdated,
    mbidsNoLength,
    mbidsFailed,
  };
}
