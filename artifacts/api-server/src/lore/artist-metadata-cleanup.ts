import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchRecordingCredits, musicbrainzEnabled } from "@workspace/song-enrichment";

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
  /**
   * Test-only override for `musicbrainzEnabled()`.  Pass `false` to simulate
   * an environment where MB is not configured; pass `true` to force-enable the
   * MB path even when `MUSICBRAINZ_CONTACT` is absent.  Never set this in
   * production — omit the field entirely so the real check runs.
   */
  _testMbEnabled?: boolean;
}

const RESOLUTION_COLLISION_KEY = "\u001f";

/** Same domain vocabulary as the ingestion guard, expressed for Postgres. */
const URL_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

/**
 * True when `mbid` is a well-formed MusicBrainz UUID
 * (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).  Synthetic `sp:` IDs and any
 * malformed values must NOT be sent to the MB API.
 */
const MB_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRealMbUuid(mbid: string): boolean {
  return MB_UUID_RE.test(mbid);
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

// ── Step 3: Repair URL/domain artist values in existing recordings ──────────

/**
 * URL/domain artist repair migration.
 *
 * Recordings whose `artist` field is a bare domain name ("wellsfargo.com") or
 * a full URL ("https://sponsor.example.com") are identified.  These values
 * entered the DB before the `isJunkMetadata` ingestion guard existed.
 *
 * For each affected recording:
 *   • If the MBID is a real UUID: the canonical artist name is fetched from
 *     MusicBrainz via `fetchRecordingCredits`.  On success the row is updated.
 *   • If the MBID is a synthetic `sp:` value: MB cannot resolve it.  These
 *     rows are counted as permanently non-repairable and left unchanged; they
 *     do NOT prevent the migration from completing.
 *
 * ## Completion semantics
 * Real-UUID candidates require a live MusicBrainz connection.  If MB is not
 * configured at the time the migration runs, the completion ledger row is NOT
 * written — the migration will retry on every subsequent boot until MB becomes
 * available and the pass can proceed.  Once MB IS configured, the migration
 * runs the full pass and writes the ledger entry regardless of how many
 * individual recordings returned no canonical artist (genuine MB misses are
 * acceptable; a missing configuration is not).
 *
 * Source protection: recordings whose only spins carry source='manual' or
 * source='backfill' are excluded — hand-curated rows must not be silently
 * rewritten.
 *
 * Idempotency: the completion key `applyUrlArtistRepair` is separate from the
 * step-1/2 key so the two passes are independently idempotent.
 *
 * `_testMbids` restricts the candidate set to specific MBIDs (test isolation
 * only — never pass this in production).
 */
export async function applyUrlArtistRepair(
  opts?: ArtistMetadataCleanupOptions,
): Promise<{ urlArtistFixed: number; urlArtistSkippedSynthetic: number }> {
  // ── Completion-ledger gate ──────────────────────────────────────────────────
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applyUrlArtistRepair' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] URL artist repair: already complete, skipping");
    return { urlArtistFixed: 0, urlArtistSkippedSynthetic: 0 };
  }

  // Optional MBID filter for test isolation.
  const mbidClause =
    opts?._testMbids?.length
      ? sql` AND r.mbid = ANY(ARRAY[${sql.join(
          opts._testMbids.map((m) => sql`${m}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  // ── Identify affected recordings ────────────────────────────────────────────
  //
  // URL detection covers two patterns:
  //   1. Starts with http:// or https:// (full URL)
  //   2. Contains .<tld> at a word boundary (bare domain like "wellsfargo.com"
  //      or "sponsor.example.fm")
  //
  // Source protection mirrors Step 1: recordings whose every spin is
  // source='manual' or source='backfill' are excluded. Orphaned recordings
  // (no spins at all) are included — they can only have come from a junk feed.
  type CandidateRow = { mbid: string; artist: string; title: string };
  const candidates = await db.execute<CandidateRow>(sql`
    SELECT r.mbid, r.artist, r.title
    FROM recordings r
    WHERE (
      r.artist ~* ${URL_ARTIST_SQL_RE}
    )
    AND (
      EXISTS (
        SELECT 1 FROM spins
        WHERE spins.mbid = r.mbid
          AND spins.source NOT IN ('manual', 'backfill')
      )
      OR NOT EXISTS (
        SELECT 1 FROM spins WHERE spins.mbid = r.mbid
      )
    )
    ${mbidClause}
  `);

  console.info(
    `[migration] URL artist repair: found ${candidates.rows.length} candidate recording(s)`,
  );

  // ── Classify candidates ─────────────────────────────────────────────────────
  //
  // • Real MB UUID (`isRealMbUuid`): need a live MB call to recover the
  //   canonical artist — these drive the completion-deferral gate.
  // • Synthetic `sp:` MBIDs: permanently non-repairable via MB — counted as
  //   skipped, never block completion.
  // • Other (malformed / test MBIDs): treated identically to sp: — skipped
  //   without a MB call.
  const realUuidCandidates = candidates.rows.filter((r) => isRealMbUuid(r.mbid));
  const syntheticCandidates = candidates.rows.filter((r) => !isRealMbUuid(r.mbid));

  // ── MB availability gate ────────────────────────────────────────────────────
  //
  // Real-UUID candidates require a live MB connection.  If MB is not available
  // we cannot fix any of them — defer the whole pass to the next boot so the
  // completion ledger is never written for an empty/partial pass.
  //
  // `opts._testMbEnabled` lets tests override the live `musicbrainzEnabled()`
  // check for deterministic results regardless of environment configuration.
  const mbAvailable =
    opts?._testMbEnabled !== undefined ? opts._testMbEnabled : musicbrainzEnabled();

  if (realUuidCandidates.length > 0 && !mbAvailable) {
    console.info(
      `[migration] URL artist repair: MusicBrainz not configured — deferring repair of ` +
        `${realUuidCandidates.length} real-UUID recording(s) to next boot`,
    );
    // Return without writing the completion row so the next boot retries.
    return { urlArtistFixed: 0, urlArtistSkippedSynthetic: 0 };
  }

  let urlArtistFixed = 0;
  const urlArtistSkippedSynthetic = syntheticCandidates.length;

  for (const { mbid, artist } of syntheticCandidates) {
    console.info(
      `[migration] URL artist repair: skipping non-UUID recording ${mbid} (artist: "${artist}")`,
    );
  }

  for (const { mbid, artist } of realUuidCandidates) {
    // Real MB UUID — look up canonical artist via the recording credits endpoint.
    // Rate limiting is handled internally by mbFetch (≥1.1 s between calls).
    let canonicalArtist: string | undefined;
    try {
      const credits = await fetchRecordingCredits(mbid);
      canonicalArtist = credits?.artistName?.trim() || undefined;
    } catch (err) {
      console.warn(
        `[migration] URL artist repair: MB lookup failed for ${mbid} (artist: "${artist}"):`,
        err,
      );
    }

    if (!canonicalArtist) {
      // MB was reachable but has no record for this MBID (genuine miss) —
      // leave the row unchanged and continue; this does not defer completion.
      console.info(
        `[migration] URL artist repair: no canonical artist from MB for ${mbid} ` +
          `(artist: "${artist}"), leaving unchanged`,
      );
      continue;
    }

    await db.execute(sql`
      UPDATE recordings
      SET artist     = ${canonicalArtist},
          updated_at = now()
      WHERE mbid = ${mbid}
    `);
    console.info(
      `[migration] URL artist repair: fixed ${mbid}: "${artist}" → "${canonicalArtist}"`,
    );
    urlArtistFixed++;
  }

  // ── Mark complete in the persistent ledger ──────────────────────────────────
  // We reach here only when MB was configured (or there were no real-UUID
  // candidates). The pass has made its best effort; future boots skip it.
  await db.execute(sql`
    INSERT INTO migration_completions (name)
    VALUES ('applyUrlArtistRepair')
    ON CONFLICT (name) DO NOTHING
  `);

  console.info(
    `[migration] URL artist repair: fixed ${urlArtistFixed} recording(s), ` +
      `skipped ${urlArtistSkippedSynthetic} sp: recording(s)`,
  );

  return { urlArtistFixed, urlArtistSkippedSynthetic };
}

/**
 * Contain synthetic URL/domain recordings left behind by the original repair.
 *
 * Synthetic `sp:` IDs cannot be sent to MusicBrainz, and deleting their
 * recording row would violate the many historical foreign keys that preserve
 * listener and broadcast provenance. Replace only the listener-facing artist
 * fields with the existing generic placeholder instead. Raw spin metadata is
 * intentionally preserved, and the completion ledger makes this idempotent.
 */
export async function applySyntheticUrlArtistCleanup(
  opts?: ArtistMetadataCleanupOptions,
): Promise<{ recordingsSanitized: number }> {
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applySyntheticUrlArtistCleanup' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] synthetic URL artist cleanup: already complete, skipping");
    return { recordingsSanitized: 0 };
  }

  const mbidClause =
    opts?._testMbids?.length
      ? sql` AND r.mbid = ANY(ARRAY[${sql.join(
          opts._testMbids.map((m) => sql`${m}`),
          sql`, `,
        )}]::text[])`
      : sql``;

  const result = await db.execute(sql`
    UPDATE recordings r
    SET artist = 'Unknown artist',
        artist_mbid = NULL,
        updated_at = now()
    WHERE r.mbid LIKE 'sp:%'
      AND r.artist ~* ${URL_ARTIST_SQL_RE}
      AND (
        EXISTS (
          SELECT 1 FROM spins s
          WHERE s.mbid = r.mbid
            AND s.source NOT IN ('manual', 'backfill')
        )
        OR NOT EXISTS (SELECT 1 FROM spins s WHERE s.mbid = r.mbid)
      )
      ${mbidClause}
  `);

  await db.execute(sql`
    INSERT INTO migration_completions (name)
    VALUES ('applySyntheticUrlArtistCleanup')
    ON CONFLICT (name) DO NOTHING
  `);

  const recordingsSanitized = Number(result.rowCount ?? 0);
  console.info(
    `[migration] synthetic URL artist cleanup: sanitized ${recordingsSanitized} recording(s)`,
  );
  return { recordingsSanitized };
}

/**
 * Detach legacy spins pinned by the old non-ASCII cache-key collision.
 *
 * Earlier normalizeKey versions stripped every non-ASCII character, making all
 * Cyrillic, Arabic, CJK, and similar pairs share the one key "\x1f". That
 * cache hit could attach unrelated raw metadata to a single popular recording.
 * Preserve the raw broadcast fields; only clear incorrect resolved links.
 */
export async function applyResolutionCollisionCleanup(
  opts?: ArtistMetadataCleanupOptions,
): Promise<{ spinsDetached: number; cacheEntriesPurged: number }> {
  const completionCheck = await db.execute(
    sql`SELECT 1 FROM migration_completions WHERE name = 'applyResolutionCollisionCleanup' LIMIT 1`,
  );
  if ((completionCheck.rows?.length ?? 0) > 0) {
    console.info("[migration] resolution collision cleanup: already complete, skipping");
    return { spinsDetached: 0, cacheEntriesPurged: 0 };
  }

  const mbidClause =
    opts?._testMbids?.length
      ? sql` AND rc.mbid = ANY(ARRAY[${sql.join(
          opts._testMbids.map((m) => sql`${m}`),
          sql`, `,
        )}]::text[])`
      : sql``;
  const cacheRows = await db.execute<{ mbid: string }>(sql`
    SELECT rc.mbid FROM resolution_cache rc
    WHERE rc.key = ${RESOLUTION_COLLISION_KEY}
      AND rc.mbid IS NOT NULL
      ${mbidClause}
  `);
  const corruptedMbids = new Set(cacheRows.rows.map((row) => row.mbid));

  // The resolution cache may have been purged by an earlier cleanup before
  // this migration ships. The historical fingerprint is still unambiguous:
  // one resolved recording with many distinct non-ASCII raw pairs. Include
  // only recordings with a canonical raw pair, so a genuinely popular
  // recording cannot be detached wholesale.
  if (opts?._testMbids?.length !== 1) {
    const legacyRows = await db.execute<{ mbid: string }>(sql`
      SELECT s.mbid
      FROM spins s
      INNER JOIN recordings r ON r.mbid = s.mbid
      WHERE s.mbid IS NOT NULL
        AND s.mbid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY s.mbid
      HAVING count(DISTINCT lower(trim(s.raw_artist)) || E'\\x1f' || lower(trim(s.raw_title))) >= 25
        AND bool_or(
          lower(trim(s.raw_artist)) = lower(trim(r.artist))
          AND lower(trim(s.raw_title)) = lower(trim(r.title))
        )
    `);
    for (const row of legacyRows.rows) corruptedMbids.add(row.mbid);
  }

  let spinsDetached = 0;
  for (const mbid of corruptedMbids) {
    const recordingRows = await db.execute<{ artist: string; title: string }>(sql`
      SELECT artist, title FROM recordings WHERE mbid = ${mbid}
    `);
    const recording = recordingRows.rows[0];
    if (!recording) continue;

    const result = await db.execute(sql`
      UPDATE spins
      SET mbid = NULL
      WHERE mbid = ${mbid}
        AND (
          raw_artist IS NULL OR raw_title IS NULL
          OR lower(trim(raw_artist)) <> lower(trim(${recording.artist}))
          OR lower(trim(raw_title)) <> lower(trim(${recording.title}))
        )
    `);
    spinsDetached += Number(result.rowCount ?? 0);
  }

  const purged = await db.execute(sql`
    DELETE FROM resolution_cache rc
    WHERE rc.key = ${RESOLUTION_COLLISION_KEY}
      ${mbidClause}
  `);
  await db.execute(sql`
    INSERT INTO migration_completions (name)
    VALUES ('applyResolutionCollisionCleanup')
    ON CONFLICT (name) DO NOTHING
  `);

  const cacheEntriesPurged = Number(purged.rowCount ?? 0);
  console.info(
    `[migration] resolution collision cleanup: detached ${spinsDetached} spin(s), purged ${cacheEntriesPurged} cache entr${cacheEntriesPurged === 1 ? "y" : "ies"}`,
  );
  return { spinsDetached, cacheEntriesPurged };
}
