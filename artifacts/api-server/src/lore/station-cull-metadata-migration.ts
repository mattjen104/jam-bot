import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Add the provenance fields used by the automatic station cull migrations.
 *
 * This is deliberately safe to run on every boot: deployments that already
 * have the columns are left untouched, while older databases gain the fields
 * before either cull migration tries to write them.
 */
export async function applyStationCullMetadataMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS automatic_cull_reason text,
      ADD COLUMN IF NOT EXISTS automatic_cull_canonical_station_id integer
  `);
}