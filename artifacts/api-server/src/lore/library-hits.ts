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
// Module-level TTL cache (5 min) — same pattern as crossings.ts
// ---------------------------------------------------------------------------

const LIBRARY_HIT_CACHE_TTL_MS = 5 * 60 * 1_000;

const libraryHitCache = new Map<number, { builtAt: number; ctx: LibraryHitContext }>();

/** Evict a user's cached entry — call before a test that needs a fresh DB hit. */
export function _testOnly_clearLibraryHitCache(userId: number): void {
  libraryHitCache.delete(userId);
}

/** Return the raw cached entry for a user — lets tests verify cache hits without spying on db. */
export function _testOnly_getLibraryHitCache(
  userId: number,
): { builtAt: number; ctx: LibraryHitContext } | undefined {
  return libraryHitCache.get(userId);
}

// ---------------------------------------------------------------------------
// Context builder (runs DB queries)
// ---------------------------------------------------------------------------

/**
 * Fetch the four membership sets for a user in parallel.
 *
 * Results are cached per user for 5 minutes so that the O(4N) per-request
 * DB cost does not scale with the number of connected listeners.
 *
 * If the spotify_library_items table does not exist in this environment the
 * soft-artist query is silently skipped — softArtistNames will be empty and
 * the artist-hit rung degrades to MBID-only matching.
 */
export async function buildLibraryHitContext(userId: number): Promise<LibraryHitContext> {
  const cached = libraryHitCache.get(userId);
  if (cached && Date.now() - cached.builtAt < LIBRARY_HIT_CACHE_TTL_MS) {
    return cached.ctx;
  }

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

  const ctx: LibraryHitContext = {
    libMbids: new Set(mbidRows.map((r) => r.mbid)),
    libRgMbids: new Set(rgRows.map((r) => r.rg)),
    libArtistMbids: new Set(artistRows.map((r) => r.artistMbid!)),
    softArtistNames: new Set(softRows.map((r) => r.artistLower)),
  };
  libraryHitCache.set(userId, { builtAt: Date.now(), ctx });
  return ctx;
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
