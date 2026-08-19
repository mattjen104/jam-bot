import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Supporting indexes for the anonymous blended crossings refresh.
 *
 * The refresh starts by finding recently present listeners, expands their
 * saved artists/release groups to recording MBIDs, then probes spins by either
 * time (rolling scores) or MBID (lifetime scores). These indexes keep that
 * setup proportional to active taste rather than the full listener catalogue.
 */
export async function applyBlendedCrossingsPerformanceIndexMigration(): Promise<void> {
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS lore_users_social_presence_last_seen_idx
      ON lore_users (social_participation, last_seen_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recordings_artist_mbid_idx
      ON recordings (artist_mbid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS rrg_release_group_primary_idx
      ON recording_release_groups (release_group_mbid, is_primary)
  `);
}