import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { normalizeGeniusFragment } from "./genius-annotations.js";

const MIGRATION_NAME = "applyGeniusFragmentPointerMigration";

/**
 * Replace legacy Genius fragment text with a receipt and length.
 *
 * The backfill and destructive column removal happen in one transaction. This
 * keeps the raw text available until every existing row has been measured and
 * hashed, while the completion ledger makes subsequent boots a no-op.
 */
export async function applyGeniusFragmentPointerMigration(): Promise<void> {
  await db.transaction(async (tx) => {
    const completion = await tx.execute(sql`
      SELECT 1
      FROM migration_completions
      WHERE name = ${MIGRATION_NAME}
      LIMIT 1
    `);
    if (completion.rows.length > 0) return;

    const columnCheck = await tx.execute<{ column_name: string }>(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'genius_annotation_drafts'
        AND column_name IN ('fragment', 'fragment_hash', 'fragment_len')
    `);
    const columns = new Set(columnCheck.rows.map((row) => row.column_name));

    await tx.execute(sql`
      ALTER TABLE genius_annotation_drafts
        ADD COLUMN IF NOT EXISTS fragment_hash text
    `);
    await tx.execute(sql`
      ALTER TABLE genius_annotation_drafts
        ADD COLUMN IF NOT EXISTS fragment_len integer
    `);

    if (columns.has("fragment")) {
      const legacyRows = await tx.execute<{ id: number; fragment: string }>(sql`
        SELECT id, fragment
        FROM genius_annotation_drafts
        WHERE fragment_hash IS NULL OR fragment_len IS NULL
      `);

      const receipts = legacyRows.rows.map((row) => {
        const normalized = normalizeGeniusFragment(row.fragment);
        return {
          id: row.id,
          hash: createHash("sha256").update(normalized, "utf8").digest("hex"),
          len: normalized.length,
        };
      });
      if (receipts.length > 0) {
        const values = sql.join(
          receipts.map((receipt) => sql`(${receipt.id}, ${receipt.hash}, ${receipt.len})`),
          sql`, `,
        );
        await tx.execute(sql`
          UPDATE genius_annotation_drafts AS drafts
          SET fragment_hash = receipts.fragment_hash,
              fragment_len = receipts.fragment_len
          FROM (VALUES ${values}) AS receipts(id, fragment_hash, fragment_len)
          WHERE drafts.id = receipts.id
        `);
      }
    }

    await tx.execute(sql`
      ALTER TABLE genius_annotation_drafts
        ALTER COLUMN fragment_hash SET NOT NULL,
        ALTER COLUMN fragment_len SET NOT NULL
    `);
    await tx.execute(sql`
      ALTER TABLE genius_annotation_drafts
        DROP COLUMN IF EXISTS fragment
    `);
    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES (${MIGRATION_NAME})
      ON CONFLICT (name) DO NOTHING
    `);
  });
}