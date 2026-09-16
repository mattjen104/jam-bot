import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/** Additive, idempotent schema for artist-scoped verified merch evidence. */
export async function applyArtistMerchMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_merch_products (
      id serial PRIMARY KEY,
      artist_mbid text NOT NULL,
      title text NOT NULL,
      destination_url text NOT NULL,
      image_url text,
      source text NOT NULL,
      source_url text NOT NULL,
      provider_product_id text,
      verification text NOT NULL DEFAULT 'trusted',
      fetched_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      removed_at timestamptz,
      status text NOT NULL DEFAULT 'active',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT artist_merch_products_source_ck
        CHECK (source IN ('bandcamp', 'artist_store', 'label_store')),
      CONSTRAINT artist_merch_products_verification_ck
        CHECK (verification IN ('exact', 'trusted')),
      CONSTRAINT artist_merch_products_status_ck
        CHECK (status IN ('active', 'removed')),
      CONSTRAINT artist_merch_products_artist_destination_source_uq
        UNIQUE (artist_mbid, destination_url, source_url)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_merch_products_artist_idx
      ON artist_merch_products (artist_mbid)
  `);
  await db.execute(sql`
    ALTER TABLE artist_merch_products
      DROP CONSTRAINT IF EXISTS artist_merch_products_artist_destination_uq
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS artist_merch_products_artist_destination_source_uq
      ON artist_merch_products (artist_mbid, destination_url, source_url)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_merch_source_targets (
      id serial PRIMARY KEY,
      artist_mbid text NOT NULL,
      source_url text NOT NULL,
      source text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      refresh_after timestamptz NOT NULL,
      last_fetched_at timestamptz,
      last_success_at timestamptz,
      last_error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT artist_merch_source_targets_source_ck
        CHECK (source IN ('bandcamp', 'artist_store', 'label_store')),
      CONSTRAINT artist_merch_source_targets_status_ck
        CHECK (status IN ('active', 'paused')),
      CONSTRAINT artist_merch_source_targets_artist_source_uq
        UNIQUE (artist_mbid, source_url)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_merch_source_targets_due_idx
      ON artist_merch_source_targets (status, refresh_after)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_merch_products_fresh_idx
      ON artist_merch_products (expires_at, status)
  `);
}

/** Durable pacing and retry state for automatic full-Library source discovery. */
export async function applyArtistMerchDiscoveryMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS artist_merch_discovery (
      artist_mbid text PRIMARY KEY,
      refresh_after timestamptz NOT NULL DEFAULT now(),
      last_checked_at timestamptz,
      last_success_at timestamptz,
      last_error text,
      discovered_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS artist_merch_discovery_due_idx
      ON artist_merch_discovery (refresh_after)
  `);
}