import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Backfill migration: tag radio_browser-sourced stations whose `name` field
 * matches a university / college pattern with tags = jsonb_array + "college".
 *
 * Radio Browser stations have no `org` field in our schema — only `name` is
 * reliably populated from the discovery API.  This migration catches genuine
 * campus stations that entered through the auto-discovery pipeline before the
 * live `upsertRadioBrowserStations` path added name-based college detection,
 * and also acts as a catch-all for any rows that slipped through.
 *
 * Matching rules (case-insensitive regex):
 *   • Name contains the word "university" (or common Romance/Germanic variants)
 *   • Name contains the word "college" (whole word — not "collège de France"
 *     false-positive avoidance, though both would qualify here).
 *   • Name contains "campus radio", "campus fm", or "campus station".
 *
 * Only touches radio_browser-sourced rows so curated hand-tagged rows are
 * never modified. Idempotent — the jsonb containment guard skips already-
 * tagged rows. Runs at every boot so newly discovered stations are caught
 * without waiting for the next re-discovery cycle.
 */
export async function applyCollegeTagMigration(): Promise<void> {
  // Use ~* (case-insensitive POSIX regex) for word-boundary matching.
  // The \m / \M word-boundary assertions in Postgres RE2 syntax are \y in
  // POSIX; use \b equivalent via (^|\W) / (\W|$) to be safe across versions.
  await db.execute(sql`
    UPDATE stations
    SET tags = COALESCE(tags, '[]'::jsonb) || '["college"]'::jsonb
    WHERE source = 'radio_browser'
      AND (
        name ~* '(^|[^a-z])university($|[^a-z])'
        OR name ~* '(^|[^a-z])universit[éèê]($|[^a-z])'
        OR name ~* '(^|[^a-z])universidade($|[^a-z])'
        OR name ~* '(^|[^a-z])universidad($|[^a-z])'
        OR name ~* '(^|[^a-z])universit[äa]t($|[^a-z])'
        OR name ~* '(^|[^a-z])universit[àá]($|[^a-z])'
        OR name ~* '(^|[^a-z])college($|[^a-z])'
        OR name ~* 'campus\\s+(radio|fm|station)'
      )
      -- Skip rows that already carry the tag (jsonb containment check).
      AND NOT (COALESCE(tags, '[]'::jsonb) @> '["college"]'::jsonb)
  `);
}
