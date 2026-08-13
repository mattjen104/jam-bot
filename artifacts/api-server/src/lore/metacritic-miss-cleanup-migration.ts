/**
 * One-shot boot migration: clear stale Metacritic miss-sentinel rows so that
 * affected albums retry on the next investigation-sheet open.
 *
 * Task 138 fixed `metacriticCandidateUrls()` to strip leading articles ("The",
 * "A", "An") from artist slugs — e.g. "The Smashing Pumpkins" now tries
 * "smashing-pumpkins" before giving up. However, albums that were already
 * looked up before the fix have a draft miss-sentinel row in `track_claims`
 * (externalId like "metacritic:miss:{releaseGroupMbid}") that permanently
 * blocks re-scraping. This migration deletes all such sentinels so the improved
 * slug logic gets a clean first attempt.
 *
 * Idempotent: the DELETE is a no-op if no draft metacritic rows remain.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function applyMetacriticMissCleanupMigration(): Promise<void> {
  const result = await db.execute<{ count: string }>(sql`
    DELETE FROM track_claims
    WHERE source_handle = 'metacritic'
      AND status = 'draft'
  `);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    console.info(
      `[lore] metacritic-miss-cleanup: deleted ${count} stale miss-sentinel row(s) — affected albums will retry on next investigation-sheet open`,
    );
  }
}
