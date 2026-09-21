import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { acquireMigrationLock, MIGRATION_LOCK_KEYS } from "./migration-advisory-lock.js";

/** Idempotent boot schema for canonical provider album facts. */
export async function applyReleaseGroupProviderMigration(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(acquireMigrationLock(MIGRATION_LOCK_KEYS.releaseGroupProvider));
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS release_group_provider_mappings (
        id serial PRIMARY KEY,
        release_group_mbid text NOT NULL,
        provider text NOT NULL,
        provider_album_id text NOT NULL,
        external_url text NOT NULL,
        official_embed_url text,
        confidence text NOT NULL DEFAULT 'exact',
        verification text NOT NULL DEFAULT 'unverified',
        dead_link boolean NOT NULL DEFAULT false,
        dead_at timestamp,
        last_verified_at timestamp,
        provenance jsonb,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT release_group_provider_mapping_uq UNIQUE (release_group_mbid, provider)
      )
    `);
    await tx.execute(sql`ALTER TABLE spotify_connections ADD COLUMN IF NOT EXISTS scopes text`);
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS release_group_provider_tracks (
        id serial PRIMARY KEY,
        mapping_id integer NOT NULL REFERENCES release_group_provider_mappings(id) ON DELETE CASCADE,
        recording_mbid text NOT NULL,
        provider_track_id text NOT NULL,
        provider_track_url text NOT NULL,
        position integer NOT NULL,
        confidence text NOT NULL DEFAULT 'exact',
        verification text NOT NULL DEFAULT 'unverified',
        dead_link boolean NOT NULL DEFAULT false,
        last_verified_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT release_group_provider_track_position_uq UNIQUE (mapping_id, position)
      )
    `);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS release_group_provider_mapping_group_idx ON release_group_provider_mappings(release_group_mbid)`);
    await tx.execute(sql`CREATE INDEX IF NOT EXISTS release_group_provider_track_mapping_idx ON release_group_provider_tracks(mapping_id)`);
    await tx.execute(sql`ALTER TABLE release_group_provider_mappings ADD COLUMN IF NOT EXISTS official_embed_url text`);
    await tx.execute(sql`ALTER TABLE release_group_provider_mappings ADD COLUMN IF NOT EXISTS external_url text`);
    await tx.execute(sql`ALTER TABLE release_group_provider_mappings ADD COLUMN IF NOT EXISTS dead_link boolean NOT NULL DEFAULT false`);
    await tx.execute(sql`ALTER TABLE release_group_provider_tracks ADD COLUMN IF NOT EXISTS provider_track_url text`);
    await tx.execute(sql`ALTER TABLE release_group_provider_tracks ADD COLUMN IF NOT EXISTS dead_link boolean NOT NULL DEFAULT false`);
    await tx.execute(sql`ALTER TABLE release_group_provider_mappings ADD COLUMN IF NOT EXISTS provenance jsonb`);
    await tx.execute(sql`ALTER TABLE release_group_provider_mappings ALTER COLUMN verification SET DEFAULT 'unverified'`);
    await tx.execute(sql`ALTER TABLE release_group_provider_tracks ALTER COLUMN verification SET DEFAULT 'unverified'`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS release_group_provider_mapping_uq ON release_group_provider_mappings(release_group_mbid, provider)`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS release_group_provider_track_position_uq ON release_group_provider_tracks(mapping_id, position)`);
  });
}