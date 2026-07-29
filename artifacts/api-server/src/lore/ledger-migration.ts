import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL migration for the listening ledger.
 *
 * What this does:
 *   1. Adds `ledger_enabled` (boolean, NOT NULL, DEFAULT false) to lore_users.
 *   2. Creates the `listens` table with all FK columns and the three indices.
 *
 * Safe to run on every boot — every statement uses IF (NOT) EXISTS or
 * ALTER COLUMN … ADD COLUMN IF NOT EXISTS (no-op when already applied).
 */
export async function applyLedgerMigration(): Promise<void> {
  try {
    // ── Step 1: opt-in consent flag on lore_users ──────────────────────────
    await db.execute(sql`
      ALTER TABLE lore_users
        ADD COLUMN IF NOT EXISTS ledger_enabled boolean NOT NULL DEFAULT false
    `);

    // ── Step 2: listens table ──────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS listens (
        id                 serial       PRIMARY KEY,
        user_id            integer      NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
        mbid               text         REFERENCES recordings(mbid),
        spin_id            integer      REFERENCES spins(id),
        station_id         integer      REFERENCES stations(id),
        picker_id          integer      REFERENCES pickers(id),
        show_id            integer      REFERENCES shows(id),
        context            text         NOT NULL,
        output_service     text         NOT NULL,
        started_at         timestamp    NOT NULL,
        ms_played          integer      NOT NULL DEFAULT 0,
        completed          boolean      NOT NULL DEFAULT false,
        release_group_mbid text
      )
    `);

    // ── Step 3: indices ────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS listens_user_started_idx
        ON listens (user_id, started_at)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS listens_user_rg_idx
        ON listens (user_id, release_group_mbid)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS listens_station_started_idx
        ON listens (station_id, started_at)
    `);

    console.log("[migration] ledger (listens + ledger_enabled): OK");
  } catch (err) {
    console.error("[lore] applyLedgerMigration failed", err);
  }
}
