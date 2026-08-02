import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * One-time data-cleanup migration: repair incorrect artist metadata in the
 * `recordings` table and purge stale resolution-cache entries that encode
 * junk artist values.
 *
 * ## Background
 * ICY and adapter metadata occasionally deliver non-artist values in the
 * artist field:
 *
 *   • Leading dash/em-dash decorator: "- Nina Simone" instead of "Nina Simone".
 *     This arises when a station's stream-title parser emits a partial or
 *     double-delimiter: "- Artist - Title" gets split into artist="- Artist".
 *
 *   • URL / domain strings: "wellsfargo.com", "https://sponsor.example.com".
 *     Ad-injection systems occasionally overwrite the ICY artist field with a
 *     sponsor URL.
 *
 *   • High-replacement-character values: encoding artefacts where most of the
 *     characters are U+FFFD, indicating severe mojibake.
 *
 * The `isJunkMetadata` gate (icy.ts) now rejects these at ingestion time, and
 * `parseStreamTitle` strips leading delimiters before passing artist+title to
 * the resolver. This migration retroactively fixes the rows that entered before
 * those guards were in place.
 *
 * ## What this does
 *
 * ### Step 1: Fix leading-dash artist values
 * UPDATE recordings SET artist = regexp_replace(artist, '^[-–—]+\s*', '')
 * for any recording whose artist field starts with a dash/en-dash/em-dash and
 * still has at least one letter after stripping (so we never blank a value).
 * Raw spin fields (raw_artist, raw_title) are never touched — they preserve
 * the original broadcast metadata for provenance.
 *
 * ### Step 2: Purge resolution-cache entries with URL/domain artist keys
 * The resolution_cache key is `normalized_artist\u001Fnormalized_title`. URL
 * normalization strips dots to spaces, so "wellsfargo.com" becomes "wellsfargo
 * com". We detect these by matching key prefixes that end with a known TLD word
 * followed by the Unit Separator (chr(31)). Deleting them forces a fresh
 * re-resolve the next time a spin with that artist+title arrives, at which
 * point the new `isJunkMetadata` guard will discard it before querying MB.
 *
 * ### Source protection
 * Recordings whose ONLY spins carry source='manual' or source='backfill' are
 * excluded from the artist fix — those entries were hand-curated or imported
 * from an archive and must not be silently altered.
 *
 * ## Idempotency / completion ledger
 * The completion row is inserted inside the same transaction as the repair
 * work, so a crash or rollback will not leave a partial completion row.
 * Subsequent boots see the completion row and return immediately.
 *
 * `applyMigrationCompletionsMigration` must have run first (registered before
 * this migration in `index.ts`).
 *
 * ## Options
 * `_testMbids` — restrict the recording candidate set to these MBIDs.
 *   ONLY for use in tests to avoid scanning every recording in the shared DB.
 */
export interface ArtistMetadataCleanupOptions {
  _testMbids?: string[];
}

export async function applyArtistMetadataCleanup(
  opts?: ArtistMetadataCleanupOptions,
): Promise<{ leadingDashFixed: number; cacheEntriesPurged: number }> {
  // ── Completion-ledger gate ──────────────────────────────────────────────────
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applyArtistMetadataCleanup' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] artist metadata cleanup: already complete, skipping");
    return { leadingDashFixed: 0, cacheEntriesPurged: 0 };
  }

  // Optional MBID filter for test isolation.
  const mbidClause =
    opts?._testMbids?.length
      ? sql` AND mbid = ANY(ARRAY[${sql.join(
          opts._testMbids.map((m) => sql`${m}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  let leadingDashFixed = 0;
  let cacheEntriesPurged = 0;

  await db.transaction(async (tx) => {
    // ── Step 1: Fix leading-dash artist values ────────────────────────────────
    //
    // Target: recordings where artist starts with one or more of [-–—] and
    // still has at least one letter after stripping (never blank a value).
    //
    // Exclusion: recordings whose spins are ALL manual/backfill sourced — those
    // were hand-curated and must not be silently rewritten.
    const dashFixResult = await tx.execute(sql`
      UPDATE recordings
      SET
        artist     = trim(regexp_replace(artist, '^[-–—]+[[:space:]]*', '')),
        updated_at = now()
      WHERE
        -- Artist starts with a dash/en-dash/em-dash
        artist ~ '^[-–—]+'
        -- After stripping, at least one character must remain (so we never blank a value)
        AND trim(regexp_replace(artist, '^[-–—]+[[:space:]]*', '')) <> ''
        -- Only update recordings that have at least one live-polled spin (not
        -- exclusively manual/backfill).  Orphaned recordings with no spins at
        -- all are also safe to fix.  Recordings whose every spin is
        -- source='manual' or source='backfill' are excluded: those entries were
        -- hand-curated or imported from an archive.
        AND (
          EXISTS (
            SELECT 1 FROM spins
            WHERE spins.mbid = recordings.mbid
              AND spins.source NOT IN ('manual', 'backfill')
          )
          OR NOT EXISTS (
            SELECT 1 FROM spins WHERE spins.mbid = recordings.mbid
          )
        )
        ${mbidClause}
    `);
    leadingDashFixed = Number(dashFixResult.rowCount ?? 0);

    // ── Step 2: Purge resolution-cache entries with URL/domain-like keys ──────
    //
    // The cache key is normalized_artist + chr(31) + normalized_title.
    // URL normalization converts dots to spaces, so "wellsfargo.com" → key
    // prefix "wellsfargo com\x1F". We match prefixes ending in a space followed
    // by a known TLD word immediately before the Unit Separator.
    //
    // This covers:
    //   wellsfargo com\x1F...
    //   https   example com\x1F...  (protocol chars normalized to spaces too)
    //   sponsor example fm\x1F...
    const cacheDeleteResult = await tx.execute(sql`
      DELETE FROM resolution_cache
      WHERE
        -- Key prefix (artist segment) ends with a space + known TLD word
        -- immediately before the unit separator (chr(31)).
        -- The anchor ensures we only match the artist segment (before \x1f).
        key ~ concat(
          '[[:space:]](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|',
          'ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)',
          chr(31)
        )
        -- Also catch bare protocol prefixes normalized to "https " or "http "
        OR key LIKE 'http %'
        OR key LIKE 'https %'
    `);
    cacheEntriesPurged = Number(cacheDeleteResult.rowCount ?? 0);

    console.info(
      `[migration] artist metadata cleanup: fixed ${leadingDashFixed} leading-dash artist(s), purged ${cacheEntriesPurged} stale cache entry/entries`,
    );

    // ── Mark complete in the persistent ledger ──────────────────────────────
    // Atomic with the cleanup work — rollback clears this too.
    await tx.execute(sql`
      INSERT INTO migration_completions (name)
      VALUES ('applyArtistMetadataCleanup')
      ON CONFLICT (name) DO NOTHING
    `);
  });

  return { leadingDashFixed, cacheEntriesPurged };
}
