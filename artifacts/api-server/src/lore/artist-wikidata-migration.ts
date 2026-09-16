import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Idempotent schema for the bounded MusicBrainz → Wikidata artist bridge. */
export async function applyArtistWikidataMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_wikidata_metadata_cache (
      artist_mbid  text PRIMARY KEY,
      wikidata_qid text,
      status       text NOT NULL DEFAULT 'error',
      payload      jsonb,
      fetched_at   timestamptz NOT NULL DEFAULT now(),
      expires_at   timestamptz NOT NULL,
      last_error   text
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_wikidata_metadata_cache_expires_idx
      ON artist_wikidata_metadata_cache (expires_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_wikidata_metadata_cache_status_idx
      ON artist_wikidata_metadata_cache (status)
  `);
}