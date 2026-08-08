import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for imported portable sets (XSPF/JSPF uploads).
 *
 * Isolation is structural: nothing here references spins, shows, stations, or
 * any radio-derived table — imported material can never affect witnessed
 * radio history, crossings, attendance, or the density spine.
 * `resolved_mbid` is deliberately a bare text column (no FK to recordings) so
 * a hostile upload can never create pressure on spine tables.
 */
export async function applyImportedSetsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS imported_sets (
      id               serial PRIMARY KEY,
      user_id          integer NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      name             text NOT NULL,
      source_filename  text NOT NULL,
      format           text NOT NULL,
      track_count      integer NOT NULL,
      resolved_count   integer NOT NULL DEFAULT 0,
      unresolved_count integer NOT NULL DEFAULT 0,
      status           text NOT NULL DEFAULT 'resolving',
      created_at       timestamp NOT NULL DEFAULT now(),
      updated_at       timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS imported_sets_user_idx ON imported_sets (user_id)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS imported_set_entries (
      id                     serial PRIMARY KEY,
      set_id                 integer NOT NULL REFERENCES imported_sets(id) ON DELETE CASCADE,
      position               integer NOT NULL,
      title                  text,
      creator                text,
      album                  text,
      duration_ms            integer,
      claimed_mbid           text,
      claimed_mbid_from_lore boolean NOT NULL DEFAULT false,
      claimed_isrc           text,
      resolution_status      text NOT NULL DEFAULT 'pending',
      resolution_basis       text,
      resolved_mbid          text,
      unresolved_reason      text,
      created_at             timestamp NOT NULL DEFAULT now(),
      updated_at             timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS imported_set_entries_set_position_uq
      ON imported_set_entries (set_id, position)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS imported_set_entries_set_idx
      ON imported_set_entries (set_id)
  `);
}
