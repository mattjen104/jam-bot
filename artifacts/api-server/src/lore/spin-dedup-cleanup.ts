import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * One-time data-cleanup migration: delete duplicate spins that were written
 * before the recency bounce guard was fixed to use normalizeKey() instead of
 * exact-string equality.
 *
 * ## Background
 * The live bounce guard (logSpinIfChanged) skips a spin when the same
 * normalised sig appeared at the same station within the last 120 s.  Before
 * the fix the recency check used raw === equality, so near-duplicates such as
 * an en-dash vs hyphen in the artist name, or a trailing space in the title,
 * slipped through and landed as separate spins.  Those rows inflate
 * `lifetimeCrossings`, which is the primary sort key for unattributed rows on
 * the dial.
 *
 * ## What this does
 *
 * ### Identifying duplicates
 * A spin is a "root" if no earlier same-sig spin at the same station exists
 * within the 120 s dedup window.  Every non-root spin is a duplicate.
 *
 * Keeper mapping is transitive-safe: for each duplicate the keeper is the
 * most-recent root whose (played_at, id) is strictly less than the duplicate.
 * This correctly handles chains such as A(t=0) → B(t=100s) → C(t=190s) —
 * B is a dup of A, C is a dup of B (but not directly within 120 s of A) —
 * because the most-recent root ≤ C is still A, and A is never itself a dup.
 *
 * ### Source restriction
 * Only live-polling sources participate in the dedup candidate set.  Rows with
 * `source IN ('manual', 'backfill')` are excluded: manual rows carry a
 * `citation` field for historical reconstruction, and archive imports may use
 * coarse or rounded timestamps that can put legitimately distinct plays inside
 * the 120 s window.  Removing those rows would permanently destroy cited
 * provenance — a core project invariant.
 *
 * ### FK safety (all inside one transaction / one connection)
 * - `pending_keeps.spin_id`  NOT NULL, ON DELETE CASCADE — remapped to the
 *   keeper spin first (preserving user save intent).  Uses INSERT … ON
 *   CONFLICT DO NOTHING so users who already have a keep on the keeper spin
 *   are not double-counted; the now-redundant dup-spin keep is then deleted.
 * - `library_items.spin_id`  nullable, no cascade — NULLed before delete.
 * - `listens.spin_id`        nullable, no cascade — NULLed before delete.
 * - `segue_edges`            joins on MBID + station + playedAt, no spin_id
 *                            FK — unaffected.
 *
 * ## Idempotency / completion ledger
 * On the first successful run the migration inserts a row into
 * `migration_completions` (inside the same transaction as the cleanup work),
 * so the gate is atomic.  On every subsequent boot the function reads that row
 * and returns immediately without touching `spins`.
 *
 * `applyMigrationCompletionsMigration` must have run first (it is registered
 * before this migration in `index.ts`).
 */
/**
 * Options accepted by applySpinDedupCleanup.
 *
 * _testStationIds — restrict the candidate set to these station IDs.
 *   ONLY for use in tests: scopes the full-table CTE to a single test
 *   station so the migration doesn't scan every spin inserted by the
 *   other 86 parallel test workers, which would inflate the query time
 *   past the per-test timeout budget.  Production callers omit this.
 */
export interface SpinDedupCleanupOptions {
  _testStationIds?: number[];
}

export async function applySpinDedupCleanup(
  opts?: SpinDedupCleanupOptions,
): Promise<void> {
  // ── Completion-ledger gate ─────────────────────────────────────────────────
  // One SELECT — the common path on every boot after the first.
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applySpinDedupCleanup' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] spin dedup cleanup: already complete, skipping");
    return;
  }

  // Optional station filter — used in tests to avoid scanning the full spins
  // table while other test workers are concurrently inserting their own rows.
  const stationClause =
    opts?._testStationIds?.length
      ? sql` AND station_id = ANY(ARRAY[${sql.join(
          opts._testStationIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::int[])`
      : sql``;

  await db.transaction(async (tx) => {
    // ── Step 1: build the dup → keeper map ─────────────────────────────────
    //
    // "Normalised sig" mirrors normalizeKey(): lowercase, strip non-alphanumeric
    // to a single space, trim, join with ASCII Unit Separator (chr(31)).
    // NFKD/accent folding is omitted; the common near-dup cases (en-dash vs
    // hyphen, trailing whitespace) are fully handled by the regexp.
    //
    // Root = a spin with no earlier same-sig spin within 120 s at the same
    // station.  Dup = every non-root.  Keeper for each dup = the most-recent
    // root before it — safe across chains.
    //
    // Source restriction: only live-polling sources are candidates.
    // 'manual' rows carry citation provenance that must never be destroyed.
    // 'backfill' rows come from archive imports whose timestamps may be
    // rounded and could falsely collapse distinct plays.
    //
    // DROP first so an aborted prior run's leftover table is never reused.
    await tx.execute(sql`DROP TABLE IF EXISTS _spin_dup_map`);

    await tx.execute(sql`
      CREATE TEMP TABLE _spin_dup_map AS
      WITH all_sigs AS (
        SELECT
          id,
          station_id,
          played_at,
          lower(trim(regexp_replace(coalesce(raw_artist, ''), '[^a-zA-Z0-9]+', ' ', 'g')))
            || chr(31)
            || lower(trim(regexp_replace(coalesce(raw_title, ''),  '[^a-zA-Z0-9]+', ' ', 'g')))
            AS sig
        FROM spins
        WHERE raw_artist IS NOT NULL
          AND raw_title   IS NOT NULL
          AND source NOT IN ('manual', 'backfill')
          ${stationClause}
      ),
      roots AS (
        -- A spin is a root if nothing earlier with the same sig sits within
        -- the 120 s window at the same station.
        SELECT s.id, s.station_id, s.sig, s.played_at
        FROM all_sigs s
        WHERE NOT EXISTS (
          SELECT 1
          FROM all_sigs e
          WHERE e.station_id = s.station_id
            AND e.sig         = s.sig
            AND e.played_at  >= s.played_at - INTERVAL '120 seconds'
            AND (
              e.played_at < s.played_at
              OR (e.played_at = s.played_at AND e.id < s.id)
            )
        )
      ),
      dups AS (
        -- Every non-root spin is a duplicate.
        SELECT d.id AS dup_id, d.station_id, d.sig, d.played_at
        FROM all_sigs d
        WHERE NOT EXISTS (SELECT 1 FROM roots r WHERE r.id = d.id)
      )
      -- For each dup, the keeper is the most-recent root before it (by
      -- played_at desc, id desc).  DISTINCT ON (dup_id) with that ORDER BY
      -- picks exactly one keeper per dup — always a true root, never a dup.
      SELECT DISTINCT ON (dups.dup_id)
        dups.dup_id      AS dup_spin_id,
        roots.id         AS keeper_spin_id
      FROM dups
      JOIN roots
        ON  roots.station_id = dups.station_id
        AND roots.sig        = dups.sig
        AND (
          roots.played_at < dups.played_at
          OR (roots.played_at = dups.played_at AND roots.id < dups.dup_id)
        )
      ORDER BY dups.dup_id, roots.played_at DESC, roots.id DESC
    `);

    // Fast-path: no duplicates → nothing to do (common on re-runs).
    const countResult = await tx.execute(
      sql`SELECT COUNT(*) AS n FROM _spin_dup_map`,
    );
    const dupCount = Number(
      (countResult.rows[0] as { n: string | number } | undefined)?.n ?? 0,
    );

    if (dupCount > 0) {
      // ── Step 2: remap pending_keeps to the keeper spin ──────────────────
      //
      // pending_keeps stores user intent ("I want to keep this track").
      // Re-point from dup spin → keeper spin before touching the spin rows.
      // ON CONFLICT DO NOTHING handles the case where the user already has a
      // keep on the keeper spin — the duplicate keep is then deleted below.
      await tx.execute(sql`
        INSERT INTO pending_keeps (user_id, spin_id, saved_at, promoted_at)
        SELECT pk.user_id, m.keeper_spin_id, pk.saved_at, pk.promoted_at
        FROM   pending_keeps pk
        JOIN   _spin_dup_map m ON pk.spin_id = m.dup_spin_id
        ON CONFLICT (user_id, spin_id) DO NOTHING
      `);

      // Remove pending_keeps that still reference a dup spin (whether
      // successfully remapped above, or already covered by an existing keep
      // on the keeper — either way the dup-spin keep is now redundant).
      await tx.execute(sql`
        DELETE FROM pending_keeps
        WHERE spin_id IN (SELECT dup_spin_id FROM _spin_dup_map)
      `);

      // ── Step 3: NULL out other nullable FK references ────────────────────
      await tx.execute(sql`
        UPDATE library_items
        SET spin_id = NULL
        WHERE spin_id IN (SELECT dup_spin_id FROM _spin_dup_map)
      `);

      await tx.execute(sql`
        UPDATE listens
        SET spin_id = NULL
        WHERE spin_id IN (SELECT dup_spin_id FROM _spin_dup_map)
      `);

      // ── Step 4: delete the duplicate spins ──────────────────────────────
      // All dependent rows have been handled above; no cascade surprises.
      await tx.execute(sql`
        DELETE FROM spins
        WHERE id IN (SELECT dup_spin_id FROM _spin_dup_map)
      `);
    }

    await tx.execute(sql`DROP TABLE IF EXISTS _spin_dup_map`);

    console.info(
      `[migration] spin dedup cleanup: removed ${dupCount} duplicate spin(s)`,
    );

    // ── Step 5: mark complete in the persistent ledger ───────────────────
    // Inserted inside this transaction so the completion flag is atomic with
    // the cleanup work.  A crash or rollback will not leave a completion row.
    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES ('applySpinDedupCleanup')
      ON CONFLICT (name) DO NOTHING
    `);
  });
}
