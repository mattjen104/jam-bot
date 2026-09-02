import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive storage for source duration hints used by safe metadata replay. */
export async function applySpinDurationMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE spins ADD COLUMN IF NOT EXISTS duration_ms integer
  `);
}