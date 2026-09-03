import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Adds explicit timing provenance to spins. This is intentionally schema-only:
 * rewriting the large historical table would delay boot, and read-time legacy
 * handling already degrades old rows to inferred rather than source-trusted.
 */
export async function applySpinTimingMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE spins
      ADD COLUMN IF NOT EXISTS timing_kind text,
      ADD COLUMN IF NOT EXISTS timing_reason text,
      ADD COLUMN IF NOT EXISTS timing_uncertainty_ms integer,
      ADD COLUMN IF NOT EXISTS source_started_at timestamp
  `);
}