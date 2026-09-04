import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Index-backed contains matching for the public artist typeahead.
 *
 * The endpoint searches a normalized recording artist before expanding only a
 * bounded set of matching canonical identities into spin counts.
 */
export async function applyArtistSuggestionsIndexMigration(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recordings_artist_search_trgm_idx
      ON recordings
      USING gin (lower(trim(artist)) gin_trgm_ops)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS recordings_artist_fallback_key_idx
      ON recordings (
        lower(regexp_replace(artist, '[^[:alnum:]]', '', 'g'))
      )
      WHERE artist_mbid IS NULL
  `);
}