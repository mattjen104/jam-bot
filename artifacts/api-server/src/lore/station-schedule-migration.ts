import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { INVISIBLE_CHARS_PG_CLASS } from "./schedule-name-sanitizer.js";

// The shared invisible-char class, as a quoted Postgres string literal.
// Derived from the same range list as the parse-time sanitizer in
// schedule-scraper.ts so the two implementations cannot drift; interpolated
// with sql.raw because it is a compile-time constant, never user input.
const INVISIBLE_CLASS = sql.raw(`'${INVISIBLE_CHARS_PG_CLASS}'`);

/**
 * Idempotent DDL migration for the scraped-schedule table. Uses
 * `CREATE TABLE IF NOT EXISTS` so it is safe to run on every server boot.
 *
 * `scraped_shows` holds the station's own published weekly programming grid
 * (LLM-extracted from its homepage/schedule page) — distinct from `shows`,
 * which is derived from actually-logged spins.
 *
 * ## Idempotency / completion ledger
 * The DDL statements (CREATE TABLE / INDEX IF NOT EXISTS, ALTER TABLE ADD
 * COLUMN IF NOT EXISTS) are safe to run on every boot. The DML — the
 * `upcoming_show_count` backfill UPDATE and the one-time invisible-character
 * cleanup — run exactly once: on first run they insert a row into
 * `migration_completions` (inside a transaction) so every subsequent boot
 * skips the DML entirely.
 *
 * `applyMigrationCompletionsMigration` must have run first (it is registered
 * before this migration in `index.ts`).
 */
export async function applyStationScheduleMigration(): Promise<void> {
  // ── DDL: always run (all statements are idempotent) ───────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scraped_shows (
      id            serial PRIMARY KEY,
      station_id    integer NOT NULL REFERENCES stations(id),
      show_name     text NOT NULL,
      day_of_week   text NOT NULL,
      start_time    text NOT NULL,
      end_time      text NOT NULL,
      dj_name       text,
      source_url    text,
      scraped_at    timestamptz NOT NULL DEFAULT now(),
      extraction    text,
      voided_at     timestamptz,
      void_reason   text,
      created_at    timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS scraped_shows_slot_uq
      ON scraped_shows (station_id, day_of_week, start_time, show_name)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS scraped_shows_station_idx
      ON scraped_shows (station_id)
  `);
  // Freshness marker set on every successful schedule scrape (including a
  // legitimate empty result) — see stationsTable.scheduleScrapedAt for why
  // this can't be derived from scraped_shows row presence.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_scraped_at timestamptz
  `);
  // Attempt marker (success OR failure) — drives the failure-retry backoff
  // so a persistently-failing station isn't retried every tick forever.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_attempted_at timestamptz
  `);
  // Denormalized show count — written in the same transaction as each full
  // scraped_shows replace, so the Featured tab never needs a second join.
  // NOT NULL DEFAULT 0: Postgres adds this as a catalog-only default (instant,
  // no table rewrite on Postgres 11+), so all existing rows immediately read 0.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS upcoming_show_count integer NOT NULL DEFAULT 0
  `);
  // Pre-known schedule page URL — when set, the scraper fetches this directly
  // and skips the homepage + link-discovery step. Null = fall back to discovery.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS schedule_url text
  `);
  // Stored IANA timezone — inferred from city + country by the seed and
  // backfill, so the upcoming-schedule endpoint never re-computes it at
  // query time. Null = inference was not confident enough (UI degrades to
  // "station's local time"). ADD COLUMN IF NOT EXISTS ensures idempotency
  // across all environments regardless of when drizzle-kit push was last run.
  await db.execute(sql`
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS iana_timezone text
  `);

  // Receipt columns were added after scraped_shows had already been deployed.
  // Add them nullable first so legacy rows can be backfilled transactionally
  // below, then enforce the invariant after the backfill.
  await db.execute(sql`
    ALTER TABLE scraped_shows ADD COLUMN IF NOT EXISTS source_url text
  `);
  await db.execute(sql`
    ALTER TABLE scraped_shows ADD COLUMN IF NOT EXISTS extraction text
  `);
  await db.execute(sql`
    ALTER TABLE scraped_shows ADD COLUMN IF NOT EXISTS voided_at timestamptz
  `);
  await db.execute(sql`
    ALTER TABLE scraped_shows ADD COLUMN IF NOT EXISTS void_reason text
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ADD COLUMN IF NOT EXISTS source_url text
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ADD COLUMN IF NOT EXISTS scraped_at timestamptz
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ALTER COLUMN scraped_at SET DEFAULT now()
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ADD COLUMN IF NOT EXISTS extraction text
  `);

  // This receipt backfill has its own ledger key: the older schedule migration
  // may already be marked complete in a deployed database.
  const receiptCompletionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applyExtractionReceiptMigration' LIMIT 1`,
  );
  if ((receiptCompletionCheck.rows?.length ?? 0) === 0) {
    await db.transaction(async (tx) => {
      // The schedule scraper was the only historical writer for this table,
      // so old rows are honestly marked as LLM output. A station URL is the
      // strongest source pointer available for those legacy rows.
      await tx.execute(sql`
        UPDATE scraped_shows ss
        SET source_url = COALESCE(
          NULLIF(st.schedule_url, ''),
          NULLIF(st.homepage_url, '')
        ),
        extraction = 'llm'
        FROM stations st
        WHERE st.id = ss.station_id
          AND (ss.source_url IS NULL OR btrim(ss.source_url) = '' OR ss.extraction IS NULL)
      `);

      // A legacy schedule row with no source URL cannot be audited honestly;
      // remove it rather than inventing a citation or retaining a partial fact.
      const removedUncited = await tx.execute(sql`
        DELETE FROM scraped_shows
        WHERE source_url IS NULL OR btrim(source_url) = ''
      `);
      if ((removedUncited.rowCount ?? 0) > 0) {
        console.warn(
          `[migration] removed ${removedUncited.rowCount} uncited legacy scraped_shows row(s)`,
        );
      }

      await tx.execute(sql`
        UPDATE list_entries le
        SET source_url = l.url,
            scraped_at = COALESCE(le.scraped_at, l.retrieved_at, now()),
            extraction = COALESCE(le.extraction, 'llm')
        FROM lists l
        WHERE l.id = le.list_id
          AND (le.source_url IS NULL OR le.scraped_at IS NULL OR le.extraction IS NULL)
      `);
      const removedUncitedLists = await tx.execute(sql`
        DELETE FROM list_entries
        WHERE source_url IS NULL OR btrim(source_url) = ''
      `);
      if ((removedUncitedLists.rowCount ?? 0) > 0) {
        console.warn(
          `[migration] removed ${removedUncitedLists.rowCount} uncited legacy list_entries row(s)`,
        );
      }

      await tx.execute(sql`
        INSERT INTO migration_completions (name)
        VALUES ('applyExtractionReceiptMigration')
        ON CONFLICT (name) DO NOTHING
      `);
    });
  }

  // Keep these constraints enforced even when the receipt DML ledger already
  // exists (for example after a restart during a schema rollout).
  await db.execute(sql`
    ALTER TABLE scraped_shows ALTER COLUMN source_url SET NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE scraped_shows ALTER COLUMN extraction SET NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ALTER COLUMN source_url SET NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ALTER COLUMN scraped_at SET NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE list_entries ALTER COLUMN extraction SET NOT NULL
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE scraped_shows
        ADD CONSTRAINT scraped_shows_extraction_ck
        CHECK (extraction IN ('llm', 'api', 'manual') AND btrim(source_url) <> '');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE list_entries
        ADD CONSTRAINT list_entries_extraction_ck
        CHECK (extraction IN ('llm', 'api', 'manual') AND btrim(source_url) <> '');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);
  console.info("[migration] scraped_shows table: OK");

  // ── Completion-ledger gate (DML only) ─────────────────────────────────────
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applyStationScheduleMigration' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] station-schedule DML: already complete, skipping");
    return;
  }

  await db.transaction(async (tx) => {
    // ── upcoming_show_count backfill ──────────────────────────────────────
    // Stations that already have scraped_shows rows would stay at 0 until
    // their next weekly re-scrape without this one-time fix. Running the
    // UPDATE is safe — it is cheap (index scan on station_id), and stations
    // that have never been scraped correctly stay 0.
    await tx.execute(sql`
      UPDATE stations s
      SET upcoming_show_count = (
        SELECT count(*)::int FROM scraped_shows ss WHERE ss.station_id = s.id
      )
      WHERE upcoming_show_count = 0
    `);

    // ── Invisible-character cleanup ───────────────────────────────────────
    // One-time data cleanup: rows written before the parse-time sanitizer
    // landed can still hold zero-width characters in show_name/dj_name
    // (e.g. "Morning\u200BJazz"), which render without a space and break
    // text matching until the station happens to be re-scraped.
    //
    // Applies the same normalization as `sanitizeName` in schedule-scraper.ts:
    // invisible/odd whitespace → space, whitespace collapsed, trimmed.
    // Because (station_id, day_of_week, start_time, show_name) is a unique
    // key, a dirty row whose cleaned name collides with an existing row (or
    // with another dirty row normalizing to the same name) is deleted instead
    // of updated.

    // 1) Delete dirty show_name rows whose cleaned name would collide with an
    //    already-clean row, or with a lower-id dirty sibling normalizing to
    //    the same slot key (keep the lowest id among those siblings).
    const deleted = await tx.execute(sql`
      WITH cleaned AS (
        SELECT id, station_id, day_of_week, start_time, show_name,
               btrim(regexp_replace(regexp_replace(show_name,
                 ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g')) AS clean_name
        FROM scraped_shows
        WHERE show_name ~ ${INVISIBLE_CLASS}
      )
      DELETE FROM scraped_shows s
      USING cleaned c
      WHERE s.id = c.id
        AND (
          EXISTS (
            SELECT 1 FROM scraped_shows o
            WHERE o.station_id = c.station_id
              AND o.day_of_week = c.day_of_week
              AND o.start_time = c.start_time
              AND o.show_name = c.clean_name
          )
          OR EXISTS (
            SELECT 1 FROM cleaned o
            WHERE o.station_id = c.station_id
              AND o.day_of_week = c.day_of_week
              AND o.start_time = c.start_time
              AND o.clean_name = c.clean_name
              AND o.id < c.id
          )
        )
    `);
    // 2) Rewrite the surviving dirty show_name rows in place.
    const updatedShows = await tx.execute(sql`
      UPDATE scraped_shows
      SET show_name = btrim(regexp_replace(regexp_replace(show_name,
        ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g'))
      WHERE show_name ~ ${INVISIBLE_CLASS}
    `);
    // 3) dj_name is not part of the unique key, so a plain rewrite suffices;
    //    a name that cleans down to nothing becomes NULL (matching the parser,
    //    which stores null for empty DJ names).
    const updatedDjs = await tx.execute(sql`
      UPDATE scraped_shows
      SET dj_name = nullif(btrim(regexp_replace(regexp_replace(dj_name,
        ${INVISIBLE_CLASS}, ' ', 'g'), '\\s+', ' ', 'g')), '')
      WHERE dj_name IS NOT NULL AND dj_name ~ ${INVISIBLE_CLASS}
    `);
    const total =
      (deleted.rowCount ?? 0) +
      (updatedShows.rowCount ?? 0) +
      (updatedDjs.rowCount ?? 0);
    if (total > 0) {
      console.info(
        `[migration] scraped_shows zero-width cleanup: ${deleted.rowCount ?? 0} duplicate(s) deleted, ${updatedShows.rowCount ?? 0} show name(s) rewritten, ${updatedDjs.rowCount ?? 0} DJ name(s) rewritten`,
      );
    }

    // Mark complete inside the transaction so the flag is atomic with the work.
    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES ('applyStationScheduleMigration')
      ON CONFLICT (name) DO NOTHING
    `);
  });

  console.info("[migration] station-schedule DML: OK");
}
