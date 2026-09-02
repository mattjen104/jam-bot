import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Add the persisted station character read models without requiring a
 * destructive schema push. The catalog check avoids taking an
 * ACCESS EXCLUSIVE lock on every API restart when both columns already exist.
 */
export async function applyStationRecentProfileMigration(): Promise<void> {
  const existing = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stations'
      AND column_name IN ('recent_profile', 'freshness_signal')
  `);
  if (existing.rows.length === 2) {
    console.info("[migration] station recent profile fields: already present");
    return;
  }

  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS recent_profile jsonb,
      ADD COLUMN IF NOT EXISTS freshness_signal jsonb
  `);
  console.info("[migration] station recent profile fields: OK");
}