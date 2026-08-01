/**
 * library-hits.ts — single source of truth for per-spin library hit detection.
 *
 * Replaces the dual-implementation that previously existed on the server
 * (crossings.ts) and client (useDialData.ts).  Every endpoint that needs to
 * annotate spins with isLibraryHit / isArtistHit should use this module.
 *
 * Typical flow:
 *   const ctx = await buildLibraryHitContext(userId);
 *   for (const spin of spins) {
 *     const { isLibraryHit, isArtistHit } = checkLibraryHit(ctx, spin);
 *     ...
 *   }
 */

import {
  db,
  libraryItemsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  spotifyLibraryItemsTable,
} from "@workspace/db";
import { eq, and, isNotNull, isNull, ne, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

/**
 * Membership sets derived from a user's library.  Built once per
 * request/connection by buildLibraryHitContext; consumed by checkLibraryHit
 * (pure, no I/O).
 */
export type LibraryHitContext = {
  /** Exact recording MBIDs in the user's library_items. */
  libMbids: Set<string>;
  /** Primary release-group MBIDs of library recordings (album widening). */
  libRgMbids: Set<string>;
  /** Artist MBIDs of library recordings. */
  libArtistMbids: Set<string>;
  /** Lowercased, trimmed artist names from unresolved Spotify imports. */
  softArtistNames: Set<string>;
};

/** Zero-hit context — used for unauthenticated callers. */
export const EMPTY_HIT_CONTEXT: LibraryHitContext = {
  libMbids: new Set(),
  libRgMbids: new Set(),
  libArtistMbids: new Set(),
  softArtistNames: new Set(),
};

// ---------------------------------------------------------------------------
// Context builder (runs DB queries)
// ---------------------------------------------------------------------------

/**
 * Fetch the four membership sets for a user in parallel.
 *
 * If the spotify_library_items table does not exist in this environment the
 * soft-artist query is silently skipped — softArtistNames will be empty and
 * the artist-hit rung degrades to MBID-only matching.
 */
export async function buildLibraryHitContext(userId: number): Promise<LibraryHitContext> {
  const [mbidRows, rgRows, artistRows, softRows] = await Promise.all([
    // 1. Exact recording MBIDs in library
    db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, userId)),

    // 2. Primary release-group MBIDs for library recordings (album widening)
    db
      .select({ rg: recordingReleaseGroupsTable.releaseGroupMbid })
      .from(recordingReleaseGroupsTable)
      .innerJoin(
        libraryItemsTable,
        eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
      )
      .where(
        and(
          eq(libraryItemsTable.userId, userId),
          eq(recordingReleaseGroupsTable.isPrimary, true),
        ),
      ),

    // 3. Artist MBIDs of library recordings
    db
      .select({ artistMbid: recordingsTable.artistMbid })
      .from(recordingsTable)
      .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .where(
        and(
          eq(libraryItemsTable.userId, userId),
          isNotNull(recordingsTable.artistMbid),
        ),
      ),

    // 4. Soft artist names from unresolved Spotify imports (table may be absent)
    db
      .selectDistinct({
        artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))`,
      })
      .from(spotifyLibraryItemsTable)
      .where(
        and(
          eq(spotifyLibraryItemsTable.userId, userId),
          isNull(spotifyLibraryItemsTable.mbid),
          ne(spotifyLibraryItemsTable.artist, ""),
        ),
      )
      .catch((): { artistLower: string }[] => []),
  ]);

  return {
    libMbids: new Set(mbidRows.map((r) => r.mbid)),
    libRgMbids: new Set(rgRows.map((r) => r.rg)),
    libArtistMbids: new Set(artistRows.map((r) => r.artistMbid!)),
    softArtistNames: new Set(softRows.map((r) => r.artistLower)),
  };
}

// ---------------------------------------------------------------------------
// Pure hit classifier
// ---------------------------------------------------------------------------

/**
 * Classify a single spin against a pre-built library hit context.
 *
 * isLibraryHit — exact MBID match, OR any track from the same primary
 *   release group is in the library (album widening).
 * isArtistHit  — artist in library (by MBID or soft name) but not the
 *   exact track/album; the rung-3 "fan" signal.
 */
export function checkLibraryHit(
  ctx: LibraryHitContext,
  spin: {
    mbid?: string | null;
    releaseGroupMbid?: string | null;
    artistMbid?: string | null;
    artist: string;
  },
): { isLibraryHit: boolean; isArtistHit: boolean } {
  const exactHit = spin.mbid != null && ctx.libMbids.has(spin.mbid);
  const rgHit =
    !exactHit &&
    spin.releaseGroupMbid != null &&
    ctx.libRgMbids.has(spin.releaseGroupMbid);
  const isLibraryHit = exactHit || rgHit;

  const isArtistHit =
    !isLibraryHit &&
    ((spin.artistMbid != null && ctx.libArtistMbids.has(spin.artistMbid)) ||
      ctx.softArtistNames.has(spin.artist.toLowerCase().trim()));

  return { isLibraryHit, isArtistHit };
}
