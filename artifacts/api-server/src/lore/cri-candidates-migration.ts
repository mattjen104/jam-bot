import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Add the structured ICY probe fields used by CRI review.
 *
 * The CRI table predates the probe result detail, so these columns must be
 * additive and idempotent for existing deployments.
 */
export async function applyCriCandidatesMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE cri_candidates
      ADD COLUMN IF NOT EXISTS current_artist text,
      ADD COLUMN IF NOT EXISTS current_title text,
      ADD COLUMN IF NOT EXISTS station_label text
  `);
  await db.execute(sql`
    UPDATE cri_candidates
    SET icy_status = 'unknown'
    WHERE icy_status = 'yes'
      AND (
        current_artist IS NULL OR btrim(current_artist) = ''
        OR current_title IS NULL OR btrim(current_title) = ''
      )
  `);
}