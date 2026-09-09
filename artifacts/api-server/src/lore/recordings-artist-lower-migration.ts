import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Functional index backing artist-keyed lookups over `recordings`
 * (`lower(trim(artist)) = ?`). The Library set-contexts artist fallback joins
 * recordings this way; without the index every chunk seq-scans ~300k rows.
 * Safe to run on every boot — IF NOT EXISTS.
 */
export async function applyRecordingsArtistLowerMigration(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recordings_artist_lower_trim_idx
      ON recordings (lower(trim(artist)))
  `);
}
