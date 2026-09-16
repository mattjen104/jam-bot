import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Additive, repeatable DDL for station-owned editorial RSS publications.
 *
 * `rss_articles.picker_id` remains the article ledger owner. This table is an
 * explicit, optional link from that existing blog picker to a station (and,
 * when known, a show). It deliberately does not overload handles, feed URLs,
 * station slugs, show identities, or NTS aliases.
 */
export async function applyEditorialRssOwnershipMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS editorial_rss_ownerships (
      id serial PRIMARY KEY,
      picker_id integer NOT NULL UNIQUE
        REFERENCES pickers(id) ON DELETE CASCADE,
      station_id integer NOT NULL
        REFERENCES stations(id) ON DELETE CASCADE,
      show_id integer
        REFERENCES shows(id) ON DELETE SET NULL,
      evidence_url text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS editorial_rss_ownerships_station_idx
      ON editorial_rss_ownerships (station_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS editorial_rss_ownerships_show_idx
      ON editorial_rss_ownerships (show_id)
  `);
}