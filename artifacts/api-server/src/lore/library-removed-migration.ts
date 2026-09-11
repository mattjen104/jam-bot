import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DDL for the library active/removed state:
 * - `library_items.removed_at` — non-null when the listener deselected the
 *   track (it stays in the timeline, grayed, and is excluded from crossings
 *   and library-hit computations). Nothing is ever deleted.
 * - `spotify_library_items.removed_at` — same semantics for soft rows.
 * - `library_items_mbid_idx` — supports recording-centric background
 *   enrichment without scanning each listener's whole Library.
 * Safe to run on every boot — all statements use IF NOT EXISTS.
 */
export async function applyLibraryRemovedMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE library_items ADD COLUMN IF NOT EXISTS removed_at timestamp
  `);
  await db.execute(sql`
    ALTER TABLE spotify_library_items ADD COLUMN IF NOT EXISTS removed_at timestamp
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS library_items_mbid_idx
      ON library_items (mbid)
  `);
}
