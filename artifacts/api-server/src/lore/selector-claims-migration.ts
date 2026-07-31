import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the selector-claims feature:
 * - `selector_claims` table: one row per picker, tracks opt-out + future
 *   claim/verify lifecycle (pending → verified).
 * Safe to run on every boot — uses CREATE TABLE / INDEX IF NOT EXISTS.
 */
export async function applySelectorClaimsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS selector_claims (
      id           serial PRIMARY KEY,
      picker_id    integer NOT NULL REFERENCES pickers(id),
      user_id      integer REFERENCES lore_users(id),
      status       text NOT NULL DEFAULT 'unclaimed',
      verified_via text,
      verified_at  timestamp,
      bio          text,
      opted_out    boolean NOT NULL DEFAULT false,
      created_at   timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS selector_claims_picker_uq
      ON selector_claims (picker_id)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS selector_claims_user_idx
      ON selector_claims (user_id)
  `);
}
