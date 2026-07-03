import { db, recordingsTable, trackClaimsTable } from "@workspace/db";
import { isNull, like, and, eq } from "drizzle-orm";
import { fetchWikipediaClaims } from "./wikipedia.js";

/**
 * Background Wikipedia enrichment job.
 *
 * Runs periodically to find recordings that have never had a Wikipedia check
 * (no `wikipedia:%` or `wikipedia-album:%` sentinel/draft rows) and processes
 * them in small batches. This ensures every recording eventually gets a
 * Wikipedia check regardless of whether its song page is ever viewed.
 *
 * Design notes:
 * - Processes serially within each batch to respect the MB 1 req/1.2s limit
 *   (the wikipedia.ts pipeline makes a MusicBrainz call for album lookup).
 * - Batch size is intentionally small to keep each run short and avoid
 *   blocking the Node event loop with long-running I/O chains.
 * - Idempotency is handled inside fetchWikipediaClaims — repeated batch runs
 *   skip recordings that were already processed.
 */

const BATCH_SIZE = 10;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000; // 6 hours
const WARMUP_MS = 10 * 60 * 1000; // 10 min after boot

let started = false;
const timers: NodeJS.Timeout[] = [];

/**
 * Find up to `limit` recording MBIDs that have no Wikipedia check row at all.
 * A recording is "unchecked" when there is no track_claims row whose
 * external_id starts with `wikipedia:`. Both track and album scopes use that
 * prefix pattern, so a single LEFT JOIN covers both.
 */
async function findUnchecked(limit: number): Promise<string[]> {
  const rows = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .leftJoin(
      trackClaimsTable,
      and(
        eq(trackClaimsTable.mbid, recordingsTable.mbid),
        like(trackClaimsTable.externalId, `wikipedia:%`),
      ),
    )
    .where(isNull(trackClaimsTable.id))
    .limit(limit);
  return rows.map((r) => r.mbid);
}

async function runBatch(): Promise<void> {
  try {
    const mbids = await findUnchecked(BATCH_SIZE);
    if (mbids.length === 0) return;

    console.info(
      `[lore] wikipedia-job: processing ${mbids.length} unchecked recording(s)`,
    );
    for (const mbid of mbids) {
      const { draftsCreated } = await fetchWikipediaClaims(mbid);
      if (draftsCreated > 0) {
        console.info(
          `[lore] wikipedia-job: ${draftsCreated} draft(s) created for ${mbid}`,
        );
      }
    }
  } catch (err) {
    console.warn("[lore] wikipedia-job batch failed:", err);
  }
}

/** Start the periodic Wikipedia enrichment job. Idempotent — safe to call once at boot. */
export function startWikipediaJob(): void {
  if (started) return;
  started = true;

  const warmup = setTimeout(() => {
    void runBatch();
    const interval = setInterval(() => void runBatch(), RUN_EVERY_MS);
    timers.push(interval);
  }, WARMUP_MS);
  timers.push(warmup);

  console.info("[lore] wikipedia enrichment job scheduled (6h interval)");
}

/** Stop the job (tests / graceful shutdown). */
export function stopWikipediaJob(): void {
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  started = false;
}
