import { db, recordingsTable, libraryItemsTable } from "@workspace/db";
import { isNull, and, sql, exists, eq } from "drizzle-orm";
import { createMbResolver, musicbrainzEnabled } from "@workspace/song-enrichment";

/**
 * ISRC enrichment for library recordings — makes exports portable.
 *
 * Target set: recordings referenced by at least one library_items row that
 * have no ISRC and have never been *checked* (`isrcCheckedAt IS NULL`). The
 * checked-at marker is set on every attempt — hit or miss — so recordings
 * MusicBrainz has no ISRC for aren't re-fetched forever.
 *
 * Uses an isolated MusicBrainz resolver chain (own ≥1.1 s pacing) so this
 * job never competes with the import worker or the enrichment pipeline.
 */

const resolver = createMbResolver();

/** Per-lookup hard cap so one hung call can't wedge the batch. */
const LOOKUP_TIMEOUT_MS = 15_000;

export async function enrichIsrcBatch(batchSize = 25): Promise<{
  scanned: number;
  found: number;
  remaining: number;
}> {
  const targetWhere = and(
    isNull(recordingsTable.isrc),
    isNull(recordingsTable.isrcCheckedAt),
    exists(
      db
        .select({ one: sql`1` })
        .from(libraryItemsTable)
        .where(eq(libraryItemsTable.mbid, recordingsTable.mbid)),
    ),
  );

  const rows = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(targetWhere)
    .limit(batchSize);

  let found = 0;
  for (const row of rows) {
    try {
      const isrc = await resolver.fetchIsrcByMbid(
        row.mbid,
        AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      );
      if (isrc) found++;
      await db
        .update(recordingsTable)
        .set({
          ...(isrc ? { isrc } : {}),
          isrcCheckedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(recordingsTable.mbid, row.mbid));
    } catch (err) {
      console.error("[lore] isrc enrichment row failed", row.mbid, err);
    }
  }

  const [remainingRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(targetWhere);

  return { scanned: rows.length, found, remaining: remainingRow?.count ?? 0 };
}

/**
 * Self-rescheduling loop. Unlike the genre backfill (which stops when the
 * table converges), library keeps arrive continuously — so when the target
 * set is empty this idles on a slow tick instead of exiting.
 */
const ACTIVE_TICK_MS = 15_000;
const IDLE_TICK_MS = 10 * 60_000;
let running = false;

export function startIsrcEnrichmentJob(): void {
  if (running) return;
  if (!musicbrainzEnabled()) {
    console.warn("[lore] isrc enrichment disabled: MusicBrainz not configured");
    return;
  }
  running = true;
  const tick = async () => {
    let nextMs = IDLE_TICK_MS;
    try {
      const result = await enrichIsrcBatch();
      if (result.remaining > 0) nextMs = ACTIVE_TICK_MS;
    } catch (err) {
      console.error("[lore] isrc enrichment tick failed", err);
    }
    setTimeout(tick, nextMs);
  };
  setTimeout(tick, ACTIVE_TICK_MS);
}
