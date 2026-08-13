/**
 * One-shot boot migration: promote existing draft Wikipedia track_claims to
 * published.
 *
 * Before this migration was introduced, all Wikipedia claims were inserted as
 * `status='draft'` regardless of confirmation confidence. This means any
 * article that was confirmed via explicit infobox field extraction (|artist=
 * AND |name= matched) landed as draft and never appeared to the listener.
 *
 * Because we cannot retroactively determine whether each existing draft row
 * came from high-confidence infobox matching or the fallback heuristic, we
 * promote all existing Wikipedia section claims (anchor_type = 'section') to
 * published. Sentinel rows (text = 'no-target-sections', status = 'rejected')
 * are unaffected. Going forward, only fallback-heuristic matches are stored
 * as draft.
 *
 * Idempotent: the UPDATE is a no-op on subsequent boots because promoted rows
 * no longer have status='draft'.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function applyWikipediaPublishMigration(): Promise<void> {
  const result = await db.execute<{ count: string }>(sql`
    UPDATE track_claims
    SET status = 'published'
    WHERE status = 'draft'
      AND source_handle IN ('wikipedia', 'wikipedia-album')
      AND anchor_type = 'section'
  `);
  const count = result.rowCount ?? 0;
  if (count > 0) {
    console.info(
      `[lore] wikipedia-publish-migration: promoted ${count} draft Wikipedia claim(s) to published`,
    );
  }
}
