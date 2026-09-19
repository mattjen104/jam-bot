import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function applyCollectionMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS lore_collections (
      id BIGSERIAL PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES lore_users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('album', 'playlist')),
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      curator_notes TEXT,
      cover_art TEXT,
      entries JSONB NOT NULL,
      published_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS lore_collections_owner_idx ON lore_collections(owner_id);
  `);
}