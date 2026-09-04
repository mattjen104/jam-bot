import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ERA_GENRE_STATION_PATTERNS,
  ERA_GENRE_FIP_SLUGS,
  RADIO_BROWSER_NAME_BLOCKLIST,
} from "./radio-browser.js";

/**
 * Boot migration: add era_genre_mode column and classify matching stations.
 *
 * Era/genre stations are era-themed (decade/oldies/retro) and single-genre
 * algorithmic brand channels that dilute the human-curated dial. They do not
 * belong in the normal public dial but remain accessible via
 * GET /api/stations?mode=era-genre. Classification is by name (word-boundary
 * matched) plus explicit FIP thematic sub-channel slugs.
 *
 * Precedence (must run AFTER applySleepStationsMigration):
 *   - Sleep classification wins: rows with sleep_mode=true are skipped.
 *   - Permanent blocklist wins. Two layers enforce this:
 *       (a) rows already hidden for another reason are skipped
 *           (WHERE hidden = false gate on the name-pattern step), and
 *       (b) the name-pattern step explicitly excludes every
 *           RADIO_BROWSER_NAME_BLOCKLIST match. This matters because this
 *           migration runs BEFORE applyStationBlocklistHideMigration at boot:
 *           without (b), a still-visible blocklisted row whose name also
 *           carries a genre keyword (e.g. "Lofi Hip Hop Radio" via "hip hop",
 *           "100 % COVERS LOUNGE" via "lounge") would be era-flagged here,
 *           then skipped by the blocklist migration (already hidden), and
 *           leak out through GET /api/stations?mode=era-genre.
 *     A repair step also clears era_genre_mode from any blocklisted row a
 *     previous run misclassified (keeping it hidden), so existing databases
 *     self-heal on the next boot.
 *
 * FIP sub-channels are special-cased: they get era_genre_mode=true but their
 * `hidden` flag is left untouched. Setting hidden=true would stop their
 * pollers entirely (hidden = soft-hide + poll stop), and their spin ingestion
 * must continue for crossing-history purposes. They are already excluded from
 * the normal dial via crossingEligible=false, and the ?mode=era-genre endpoint
 * filters on era_genre_mode (not hidden), so they surface in the browse mode
 * either way. The name-pattern step therefore excludes the FIP slugs so
 * "FIP Jazz" / "FIP Metal" / … are never hidden by the genre-keyword regex.
 *
 * Idempotent:
 *   - ADD COLUMN IF NOT EXISTS silently skips if already present.
 *   - The name-pattern UPDATE only touches currently-visible (hidden=false,
 *     non-sleep) rows; a second run over already-classified (now hidden=true)
 *     rows is a no-op. The FIP step gates on era_genre_mode=false.
 *
 * Word-boundary matching: Postgres `~*` with `\y` (word boundary) mirrors the
 * JS matchesWordBoundary helper — digits count as word characters, so "70er"
 * matches "70er Rock" but "gems" does NOT match "Experimentalgems".
 *
 * The pattern list is imported from radio-browser.ts (the single shared
 * constant used by the ingest path) so the two never drift.
 *
 * @see artifacts/api-server/src/lore/radio-browser.ts (ERA_GENRE_STATION_PATTERNS, isEraGenreStation)
 * @see artifacts/api-server/src/lore/sleep-stations-migration.ts (runs before this)
 */
export async function applyEraGenreStationsMigration(
  database: Pick<typeof db, "execute"> = db,
): Promise<void> {
  // Step 1: ensure the column exists (DDL).
  await database.execute(sql`
    ALTER TABLE stations
      ADD COLUMN IF NOT EXISTS era_genre_mode boolean NOT NULL DEFAULT false
  `);

  // Build a single case-insensitive word-boundary alternation regex from the
  // shared pattern list. Each pattern is regex-escaped and wrapped in \y…\y.
  const escaped = ERA_GENRE_STATION_PATTERNS.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const boundaryRegex = `\\y(${escaped.join("|")})\\y`;

  const fipSlugList = sql.join(
    ERA_GENRE_FIP_SLUGS.map((s) => sql`${s}`),
    sql`, `,
  );

  // Permanent-blocklist exclusion, built from the same shared constant as the
  // ingest guard and the blocklist hide migration so the three never drift.
  // Entries are used as UNESCAPED LIKE patterns — deliberately mirroring
  // applyStationBlocklistHideMigration's predicates (e.g. its
  // LIKE '%100% covers%' wildcard-matches "100 % COVERS LOUNGE") — so that
  // anything the blocklist migration would hide is a superset-excluded here.
  const blocklistLikeArray = sql`ARRAY[${sql.join(
    RADIO_BROWSER_NAME_BLOCKLIST.map((b) => sql`${`%${b}%`}`),
    sql`, `,
  )}]`;

  // Step 2: classify matching visible rows for Specialist Radio. The flag is
  // taxonomy, not visibility: these stations stay in the normal directory.
  // Only currently visible (hidden=false), non-sleep, non-FIP, non-blocklisted
  // rows are touched. The explicit blocklist exclusion is required (not just
  // the hidden=false gate) because this migration runs BEFORE the blocklist
  // hide migration at boot — see the header comment.
  const result = await database.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET
      era_genre_mode = true,
      hidden         = false
    WHERE hidden = false
      AND (sleep_mode IS NULL OR sleep_mode = false)
      AND slug NOT IN (${fipSlugList})
      AND LOWER(name) NOT LIKE ALL (${blocklistLikeArray})
      AND name ~* ${boundaryRegex}
  `);
  const affected = (result as { rowCount?: number }).rowCount ?? 0;

  // Step 2b: repair — clear the era flag from any blocklisted row a previous
  // run of this migration misclassified (blocklist precedence). The row stays
  // hidden (permanent blocklist), it just must not surface in ?mode=era-genre.
  const repairResult = await database.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET era_genre_mode = false
    WHERE era_genre_mode = true
      AND LOWER(name) LIKE ANY (${blocklistLikeArray})
  `);
  const repaired = (repairResult as { rowCount?: number }).rowCount ?? 0;

  // Restore rows hidden by the retired era/genre listener pool. Sleep,
  // inactive, and permanent-blocklist rows retain their existing behavior.
  const unhideResult = await database.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET hidden = false
    WHERE era_genre_mode = true
      AND active = true
      AND hidden = true
      AND (sleep_mode IS NULL OR sleep_mode = false)
      AND LOWER(name) NOT LIKE ALL (${blocklistLikeArray})
  `);
  const unhidden = (unhideResult as { rowCount?: number }).rowCount ?? 0;

  // Step 3: FIP thematic sub-channels — mode flag on, hidden set FALSE so
  // their pollers keep running and spin ingestion continues (hidden = soft-hide
  // + poll stop; these channels must keep ingesting for crossing history).
  // The ?mode=era-genre endpoint filters on era_genre_mode (not hidden) and
  // the normal dial already excludes them via crossingEligible=false, so
  // visibility policy is unaffected.
  //
  // Gated on era_genre_mode=false so this is a one-time classification: after
  // the first run the migration never touches these rows again, and a later
  // deliberate admin hide (PATCH .../flags) is NOT reverted on restart.
  const fipResult = await database.execute<{ rowcount: string }>(sql`
    UPDATE stations
    SET era_genre_mode = true,
        hidden         = false
    WHERE era_genre_mode = false
      AND (sleep_mode IS NULL OR sleep_mode = false)
      AND slug IN (${fipSlugList})
  `);
  const fipAffected = (fipResult as { rowCount?: number }).rowCount ?? 0;

  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applyEraGenreStationsMigration",
      affectedRows: affected + fipAffected,
      nameMatched: affected,
      specialistRowsRestored: unhidden,
      fipSlugs: fipAffected,
      blocklistRepaired: repaired,
    }),
  );
}
