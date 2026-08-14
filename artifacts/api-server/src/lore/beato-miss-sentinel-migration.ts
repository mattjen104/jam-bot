import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `beato_miss_sentinels` table.
 *
 * Tracks how many times a Beato episode has failed the MusicBrainz
 * resolution step.  After MAX_MISS_ATTEMPTS failures the episode is
 * permanently skipped so the 24-hour pass stops retrying it forever.
 *
 * The `track_claims` table cannot be used for this because its `mbid`
 * column is NOT NULL with a FK to `recordings` — there is no valid mbid
 * to store for an episode that never resolved.
 */
export async function applyBeatoMissSentinelMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS beato_miss_sentinels (
      video_id        text        PRIMARY KEY,
      attempts        integer     NOT NULL DEFAULT 0,
      last_attempt_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
