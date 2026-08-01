import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the `migration_completions` ledger.
 *
 * Creates the table that one-shot boot migrations write to on completion,
 * so subsequent boots can skip the expensive/destructive work with a single
 * primary-key lookup.
 *
 * Must run before any migration that depends on this ledger (i.e. before
 * `applySpinDedupCleanup`). Safe to run on every boot — uses IF NOT EXISTS.
 */
export async function applyMigrationCompletionsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS migration_completions (
      name          text        PRIMARY KEY,
      completed_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}
