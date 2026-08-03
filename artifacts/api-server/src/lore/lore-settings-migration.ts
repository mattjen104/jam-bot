import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the `lore_settings` table.
 * Stores operator-level boolean feature flags that can be toggled at runtime
 * without a server restart.  The primary key is the flag name so upserts are
 * idempotent.
 * Safe to run on every boot — all statements use IF NOT EXISTS.
 */
export async function applyLoreSettingsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_settings (
      key        text      PRIMARY KEY,
      value      boolean   NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}
