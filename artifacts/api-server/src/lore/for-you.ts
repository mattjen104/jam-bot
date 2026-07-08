/**
 * For-You ranking engine — four-tier personalized ranking of stations and
 * blog pickers against a user's library.
 *
 * Tiers (applied in order):
 *   1. Artist overlap — distinct MBIDs in library that appear in source's
 *      spins/picks (`overlap_count` in user_source_affinity).
 *   2. In-Lore behavior — same overlap restricted to explicit Keeps (not
 *      bulk-imported; `keep_overlap_count`).
 *   3. Followed-picker affinity — placeholder; contributes 0 until a
 *      follows table exists.
 *   4. Popularity cold-start — clickcount+votes for stations, pick count
 *      for blogs (always breaks ties).
 *
 * Hot path: read from `user_source_affinity` (pre-computed, simple sort).
 * Affinity is recomputed inline when the cache is missing or > 1 h stale.
 */

import {
  db,
  libraryItemsTable,
  recordingsTable,
  spinsTable,
  picksTable,
  pickersTable,
  stationsTable,
  userSourceAffinityTable,
  type LoreUser,
} from "@workspace/db";
import { eq, and, isNotNull, inArray, sql, gt } from "drizzle-orm";
import {
  fetchStationsByTag,
  filterStations,
  upsertRadioBrowserStations,
  RADIO_BROWSER_GENRE_WHITELIST,
} from "./radio-browser.js";
import { queueCrossRefDiscovery } from "./blog-crossref.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum number of sources with overlap ≥ 1 per genre pole before we
 * consider thin-genre discovery. */
export const MIN_SOURCES_PER_GENRE = 3;

/** Affinity rows older than this are recomputed before serving. */
const AFFINITY_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/** Artist name sample size stored in overlapping_artists. */
const ARTIST_SAMPLE_SIZE = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverlapProof {
  overlapping_artists: string[];
  overlap_count: number;
}

export interface ForYouStationItem {
  id: number;
  slug: string;
  name: string;
  org: string | null;
  streamUrl: string;
  streamFormat: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  tags: string[];
  clickcount: number;
  votes: number;
  /** Present only when overlap was computed (non-cold-start, source has affinity). */
  overlap?: OverlapProof;
  /** Ranking score for debug / transparency. */
  _tier1: number;
  _tier2: number;
  _tier3: number;
  _tier4: number;
}

export interface ForYouBlogItem {
  id: number;
  handle: string;
  name: string;
  homeUrl: string | null;
  tags: string[];
  pickCount: number;
  /** Present only when overlap was computed (non-cold-start, source has affinity). */
  overlap?: OverlapProof;
  _tier1: number;
  _tier2: number;
  _tier3: number;
  _tier4: number;
}

export interface ForYouGenrePole<T> {
  genre: string;
  items: T[];
}

export interface ForYouResult<T> {
  genre_poles: ForYouGenrePole<T>[];
  cold_start: boolean;
  prompt?: string;
}

export interface ThinGenre {
  genre: string;
  sourceType: "station" | "picker";
  coveredCount: number;
}

// ---------------------------------------------------------------------------
// Affinity compute job
// ---------------------------------------------------------------------------

/**
 * Compute and upsert artist-overlap affinity for every station (or blog picker)
 * against the given user's library. Safe to call on every request — idempotent
 * with DB upsert. Runs in ~100–300 ms on a small library.
 */
export async function computeUserSourceAffinity(
  userId: number,
  sourceType: "station" | "picker",
): Promise<void> {
  const userLibMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));

  // Tier-2: in-Lore behavioral items (kept or ridden tracks).
  const userBehaviorMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, userId),
        sql`${libraryItemsTable.provenance}->>'kind' IN ('keep', 'ride')`,
      ),
    );

  if (sourceType === "station") {
    // --- stations: overlap + behavior overlap ---
    const rows = await db
      .select({
        stationId: stationsTable.id,
        overlapCount: sql<number>`count(distinct ${spinsTable.mbid})::int`,
        keepOverlapCount:
          sql<number>`count(distinct ${spinsTable.mbid}) filter (where ${spinsTable.mbid} in (${userBehaviorMbids}))::int`,
        overlappingArtists:
          sql<string[]>`(array_agg(distinct ${recordingsTable.artist} order by ${recordingsTable.artist}))[1:${ARTIST_SAMPLE_SIZE}]`,
      })
      .from(spinsTable)
      .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
      .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(stationsTable.active, true),
          isNotNull(spinsTable.mbid),
          inArray(spinsTable.mbid, userLibMbids),
        ),
      )
      .groupBy(stationsTable.id);

    // Tier-3 (followed-picker affinity) requires a follow graph that does not
    // exist yet (planned in a follow-up task). Per spec, coPickerCount is 0
    // until the follow graph is available; the column is reserved for that use.
    await db.transaction(async (tx) => {
      await tx
        .delete(userSourceAffinityTable)
        .where(
          and(
            eq(userSourceAffinityTable.userId, userId),
            eq(userSourceAffinityTable.sourceType, "station"),
          ),
        );
      if (rows.length === 0) return;
      await tx.insert(userSourceAffinityTable).values(
        rows.map((r) => ({
          userId,
          sourceId: r.stationId,
          sourceType: "station" as const,
          overlapCount: r.overlapCount,
          keepOverlapCount: r.keepOverlapCount,
          coPickerCount: 0, // follow graph not yet available
          overlappingArtists: r.overlappingArtists ?? [],
          updatedAt: new Date(),
        })),
      );
    });
  } else {
    // --- blog pickers: overlap + behavior overlap ---
    const rows = await db
      .select({
        pickerId: pickersTable.id,
        overlapCount: sql<number>`count(distinct ${picksTable.mbid})::int`,
        keepOverlapCount:
          sql<number>`count(distinct ${picksTable.mbid}) filter (where ${picksTable.mbid} in (${userBehaviorMbids}))::int`,
        overlappingArtists:
          sql<string[]>`(array_agg(distinct ${recordingsTable.artist} order by ${recordingsTable.artist}))[1:${ARTIST_SAMPLE_SIZE}]`,
      })
      .from(picksTable)
      .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
      .innerJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(pickersTable.active, true),
          eq(pickersTable.pickerType, "blog"),
          isNotNull(picksTable.mbid),
          inArray(picksTable.mbid, userLibMbids),
        ),
      )
      .groupBy(pickersTable.id);

    // Tier-3 (followed-picker affinity) requires a follow graph that does not
    // exist yet (planned in a follow-up task). Per spec, coPickerCount is 0
    // until the follow graph is available; the column is reserved for that use.
    await db.transaction(async (tx) => {
      await tx
        .delete(userSourceAffinityTable)
        .where(
          and(
            eq(userSourceAffinityTable.userId, userId),
            eq(userSourceAffinityTable.sourceType, "picker"),
          ),
        );
      if (rows.length === 0) return;
      await tx.insert(userSourceAffinityTable).values(
        rows.map((r) => ({
          userId,
          sourceId: r.pickerId,
          sourceType: "picker" as const,
          overlapCount: r.overlapCount,
          keepOverlapCount: r.keepOverlapCount,
          coPickerCount: 0, // follow graph not yet available
          overlappingArtists: r.overlappingArtists ?? [],
          updatedAt: new Date(),
        })),
      );
    });
  }
}

/**
 * True when the user has no library rows (cold-start path).
 */
async function hasLibrary(userId: number): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, userId));
  return (row?.n ?? 0) > 0;
}

/**
 * True when the affinity cache is fresh enough (< AFFINITY_MAX_AGE_MS).
 */
async function affinityIsFresh(
  userId: number,
  sourceType: "station" | "picker",
): Promise<boolean> {
  const cutoff = new Date(Date.now() - AFFINITY_MAX_AGE_MS);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(userSourceAffinityTable)
    .where(
      and(
        eq(userSourceAffinityTable.userId, userId),
        eq(userSourceAffinityTable.sourceType, sourceType),
        gt(userSourceAffinityTable.updatedAt, cutoff),
      ),
    );
  return (row?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Thin-genre detection
// ---------------------------------------------------------------------------

/**
 * Inspect ranked items grouped by genre tag and return genre poles that have
 * fewer than MIN_SOURCES_PER_GENRE sources with overlap ≥ 1.
 * These poles need discovery jobs to broaden coverage.
 */
export function detectThinGenres(
  items: Array<{ tags: string[]; _tier1: number }>,
  sourceType: "station" | "picker",
): ThinGenre[] {
  const genreMap = new Map<string, number>(); // genre → count with overlap
  for (const item of items) {
    const tags = item.tags.length > 0 ? item.tags : ["uncategorized"];
    for (const tag of tags) {
      const prev = genreMap.get(tag) ?? 0;
      genreMap.set(tag, prev + (item._tier1 > 0 ? 1 : 0));
    }
  }
  const thin: ThinGenre[] = [];
  for (const [genre, coveredCount] of genreMap) {
    // Only enqueue discovery for genres where the user has SOME overlap but
    // not enough sources. Genres with zero overlap are irrelevant for
    // personalized discovery and must not trigger background jobs.
    if (coveredCount > 0 && coveredCount < MIN_SOURCES_PER_GENRE) {
      thin.push({ genre, sourceType, coveredCount });
    }
  }
  return thin;
}

// ---------------------------------------------------------------------------
// For-You Stations
// ---------------------------------------------------------------------------

/**
 * Return ranked stations for the given user. Computes/refreshes affinity if
 * stale. Groups results by genre pole.
 */
export async function getForYouStations(
  user: LoreUser,
  opts: { genre?: string; limit?: number } = {},
): Promise<ForYouResult<ForYouStationItem>> {
  const limit = Math.min(opts.limit ?? 20, 100);

  const cold = !(await hasLibrary(user.id));
  if (cold) {
    return buildColdStartStations(limit, opts.genre);
  }

  if (!(await affinityIsFresh(user.id, "station"))) {
    await computeUserSourceAffinity(user.id, "station");
  }

  // --- Fetch affinity rows for this user ---
  const affinityRows = await db
    .select({
      sourceId: userSourceAffinityTable.sourceId,
      overlapCount: userSourceAffinityTable.overlapCount,
      keepOverlapCount: userSourceAffinityTable.keepOverlapCount,
      coPickerCount: userSourceAffinityTable.coPickerCount,
      overlappingArtists: userSourceAffinityTable.overlappingArtists,
    })
    .from(userSourceAffinityTable)
    .where(
      and(
        eq(userSourceAffinityTable.userId, user.id),
        eq(userSourceAffinityTable.sourceType, "station"),
      ),
    );

  const affinityMap = new Map(
    affinityRows.map((r) => [
      r.sourceId,
      {
        overlapCount: r.overlapCount,
        keepOverlapCount: r.keepOverlapCount,
        coPickerCount: r.coPickerCount,
        overlappingArtists: r.overlappingArtists ?? [],
      },
    ]),
  );

  // --- Fetch all active stations (or filtered by genre) ---
  let stationQuery = db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      streamUrl: stationsTable.streamUrl,
      streamFormat: stationsTable.streamFormat,
      homepageUrl: stationsTable.homepageUrl,
      logoUrl: stationsTable.logoUrl,
      tags: stationsTable.tags,
      clickcount: stationsTable.clickcount,
      votes: stationsTable.votes,
    })
    .from(stationsTable)
    .where(eq(stationsTable.active, true));

  const stationRows = await stationQuery;

  // --- Build items with scores ---
  let items: ForYouStationItem[] = stationRows
    .filter((s) => {
      if (!opts.genre) return true;
      const tags = (s.tags ?? []).map((t) => t.toLowerCase());
      return tags.includes(opts.genre!.toLowerCase());
    })
    .map((s) => {
      const aff = affinityMap.get(s.id);
      const tier1 = aff?.overlapCount ?? 0;
      const tier2 = aff?.keepOverlapCount ?? 0;
      const tier3 = aff?.coPickerCount ?? 0;
      const tier4 = s.clickcount + s.votes;
      return {
        id: s.id,
        slug: s.slug,
        name: s.name,
        org: s.org ?? null,
        streamUrl: s.streamUrl,
        streamFormat: s.streamFormat,
        homepageUrl: s.homepageUrl ?? null,
        logoUrl: s.logoUrl ?? null,
        tags: s.tags ?? [],
        clickcount: s.clickcount,
        votes: s.votes,
        ...(aff
          ? {
              overlap: {
                overlapping_artists: aff.overlappingArtists,
                overlap_count: aff.overlapCount,
              },
            }
          : {}),
        _tier1: tier1,
        _tier2: tier2,
        _tier3: tier3,
        _tier4: tier4,
      };
    });

  // --- Four-tier sort ---
  items.sort(
    (a, b) =>
      b._tier1 - a._tier1 ||
      b._tier2 - a._tier2 ||
      b._tier3 - a._tier3 ||
      b._tier4 - a._tier4,
  );

  // --- Thin-genre detection: run on FULL sorted set before limit-slice ---
  // Detects under-covered genre poles across all candidates, not just top-N.
  // Only whitelisted niche genres trigger RadioBrowser discovery — mainstream
  // genres are excluded to avoid ingesting low-quality generic stations.
  const thin = detectThinGenres(items, "station");
  const whitelistSet = new Set<string>(RADIO_BROWSER_GENRE_WHITELIST);
  const thinWhitelisted = thin.filter((tg) => whitelistSet.has(tg.genre));
  if (thinWhitelisted.length > 0) {
    void (async () => {
      for (const tg of thinWhitelisted) {
        try {
          const raw = await fetchStationsByTag(tg.genre);
          const filtered = filterStations(raw);
          if (filtered.length > 0) {
            await upsertRadioBrowserStations(filtered, tg.genre);
          }
        } catch (err) {
          console.warn(`[for-you] station discovery failed genre="${tg.genre}"`, err);
        }
      }
    })();
  }

  items = items.slice(0, limit);

  // --- Group by genre pole, ordered by user's overlap signal ---
  const genre_poles = groupByGenre(items);

  return { genre_poles, cold_start: false };
}

async function buildColdStartStations(
  limit: number,
  genre?: string,
): Promise<ForYouResult<ForYouStationItem>> {
  const rows = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      name: stationsTable.name,
      org: stationsTable.org,
      streamUrl: stationsTable.streamUrl,
      streamFormat: stationsTable.streamFormat,
      homepageUrl: stationsTable.homepageUrl,
      logoUrl: stationsTable.logoUrl,
      tags: stationsTable.tags,
      clickcount: stationsTable.clickcount,
      votes: stationsTable.votes,
    })
    .from(stationsTable)
    .where(eq(stationsTable.active, true))
    .orderBy(
      sql`${stationsTable.clickcount} + ${stationsTable.votes} desc`,
      stationsTable.name,
    );

  const filtered = genre
    ? rows.filter((s) =>
        (s.tags ?? []).map((t) => t.toLowerCase()).includes(genre.toLowerCase()),
      )
    : rows;

  const items: ForYouStationItem[] = filtered.slice(0, limit).map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    org: s.org ?? null,
    streamUrl: s.streamUrl,
    streamFormat: s.streamFormat,
    homepageUrl: s.homepageUrl ?? null,
    logoUrl: s.logoUrl ?? null,
    tags: s.tags ?? [],
    clickcount: s.clickcount,
    votes: s.votes,
    _tier1: 0,
    _tier2: 0,
    _tier3: 0,
    _tier4: s.clickcount + s.votes,
  }));

  return {
    genre_poles: groupByGenre(items),
    cold_start: true,
    prompt: "Connect your library to see stations that play YOUR artists",
  };
}

// ---------------------------------------------------------------------------
// For-You Blogs
// ---------------------------------------------------------------------------

/**
 * Return ranked blog pickers for the given user. Computes/refreshes affinity
 * if stale. Groups results by genre pole.
 */
export async function getForYouBlogs(
  user: LoreUser,
  opts: { genre?: string; limit?: number } = {},
): Promise<ForYouResult<ForYouBlogItem>> {
  const limit = Math.min(opts.limit ?? 20, 100);

  const cold = !(await hasLibrary(user.id));
  if (cold) {
    return buildColdStartBlogs(limit, opts.genre);
  }

  if (!(await affinityIsFresh(user.id, "picker"))) {
    await computeUserSourceAffinity(user.id, "picker");
  }

  // --- Affinity rows ---
  const affinityRows = await db
    .select({
      sourceId: userSourceAffinityTable.sourceId,
      overlapCount: userSourceAffinityTable.overlapCount,
      keepOverlapCount: userSourceAffinityTable.keepOverlapCount,
      coPickerCount: userSourceAffinityTable.coPickerCount,
      overlappingArtists: userSourceAffinityTable.overlappingArtists,
    })
    .from(userSourceAffinityTable)
    .where(
      and(
        eq(userSourceAffinityTable.userId, user.id),
        eq(userSourceAffinityTable.sourceType, "picker"),
      ),
    );

  const affinityMap = new Map(
    affinityRows.map((r) => [
      r.sourceId,
      {
        overlapCount: r.overlapCount,
        keepOverlapCount: r.keepOverlapCount,
        coPickerCount: r.coPickerCount,
        overlappingArtists: r.overlappingArtists ?? [],
      },
    ]),
  );

  // --- Blog pickers + their pick counts for tier 4 ---
  const blogRows = await db
    .select({
      id: pickersTable.id,
      handle: pickersTable.handle,
      name: pickersTable.name,
      homeUrl: pickersTable.homeUrl,
      tags: pickersTable.tags,
      pickCount: sql<number>`count(${picksTable.id})::int`,
    })
    .from(pickersTable)
    .leftJoin(picksTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(eq(pickersTable.active, true), eq(pickersTable.pickerType, "blog")),
    )
    .groupBy(
      pickersTable.id,
      pickersTable.handle,
      pickersTable.name,
      pickersTable.homeUrl,
      pickersTable.tags,
    );

  // --- Build items ---
  let items: ForYouBlogItem[] = blogRows
    .filter((p) => {
      if (!opts.genre) return true;
      const tags = (p.tags ?? []).map((t) => t.toLowerCase());
      return tags.includes(opts.genre!.toLowerCase());
    })
    .map((p) => {
      const aff = affinityMap.get(p.id);
      const tier1 = aff?.overlapCount ?? 0;
      const tier2 = aff?.keepOverlapCount ?? 0;
      const tier3 = aff?.coPickerCount ?? 0;
      const tier4 = p.pickCount;
      return {
        id: p.id,
        handle: p.handle,
        name: p.name,
        homeUrl: p.homeUrl ?? null,
        tags: p.tags ?? [],
        pickCount: p.pickCount,
        ...(aff
          ? {
              overlap: {
                overlapping_artists: aff.overlappingArtists,
                overlap_count: aff.overlapCount,
              },
            }
          : {}),
        _tier1: tier1,
        _tier2: tier2,
        _tier3: tier3,
        _tier4: tier4,
      };
    });

  // --- Four-tier sort ---
  items.sort(
    (a, b) =>
      b._tier1 - a._tier1 ||
      b._tier2 - a._tier2 ||
      b._tier3 - a._tier3 ||
      b._tier4 - a._tier4,
  );

  // --- Thin-genre detection: run on FULL sorted set before limit-slice ---
  // Only whitelisted niche genres trigger cross-ref discovery.
  const thin = detectThinGenres(items, "picker");
  const whitelistSetB = new Set<string>(RADIO_BROWSER_GENRE_WHITELIST);
  const thinWhitelistedB = thin.filter((tg) => whitelistSetB.has(tg.genre));
  if (thinWhitelistedB.length > 0) {
    void (async () => {
      for (const tg of thinWhitelistedB) {
        try {
          const blogUrls = await db
            .select({ homeUrl: pickersTable.homeUrl })
            .from(pickersTable)
            .where(
              and(
                eq(pickersTable.active, true),
                eq(pickersTable.pickerType, "blog"),
                sql`${tg.genre} = ANY(${pickersTable.tags})`,
              ),
            );
          const urls = blogUrls
            .map((b) => b.homeUrl)
            .filter((u): u is string => u != null && u.length > 0);
          if (urls.length > 0) {
            queueCrossRefDiscovery(urls, "");
          }
        } catch (err) {
          console.warn(`[for-you] blog discovery failed genre="${tg.genre}"`, err);
        }
      }
    })();
  }

  items = items.slice(0, limit);

  return { genre_poles: groupByGenre(items), cold_start: false };
}

async function buildColdStartBlogs(
  limit: number,
  genre?: string,
): Promise<ForYouResult<ForYouBlogItem>> {
  const rows = await db
    .select({
      id: pickersTable.id,
      handle: pickersTable.handle,
      name: pickersTable.name,
      homeUrl: pickersTable.homeUrl,
      tags: pickersTable.tags,
      pickCount: sql<number>`count(${picksTable.id})::int`,
    })
    .from(pickersTable)
    .leftJoin(picksTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(eq(pickersTable.active, true), eq(pickersTable.pickerType, "blog")),
    )
    .groupBy(
      pickersTable.id,
      pickersTable.handle,
      pickersTable.name,
      pickersTable.homeUrl,
      pickersTable.tags,
    )
    .orderBy(sql`count(${picksTable.id}) desc`, pickersTable.name);

  const filtered = genre
    ? rows.filter((p) =>
        (p.tags ?? []).map((t) => t.toLowerCase()).includes(genre.toLowerCase()),
      )
    : rows;

  const items: ForYouBlogItem[] = filtered.slice(0, limit).map((p) => ({
    id: p.id,
    handle: p.handle,
    name: p.name,
    homeUrl: p.homeUrl ?? null,
    tags: p.tags ?? [],
    pickCount: p.pickCount,
    _tier1: 0,
    _tier2: 0,
    _tier3: 0,
    _tier4: p.pickCount,
  }));

  return {
    genre_poles: groupByGenre(items),
    cold_start: true,
    prompt: "Connect your library to see blogs that champion YOUR artists",
  };
}

// ---------------------------------------------------------------------------
// Genre grouping
// ---------------------------------------------------------------------------

/**
 * Group items by their first genre tag (or "all" if untagged).
 * Poles are ordered by the user's overlap signal (sum of _tier1 per pole),
 * so genres most represented in the user's library appear first. The "all"
 * summary pole is always appended last when multiple genre poles exist.
 * Each item appears in exactly one pole (its first tag) to keep the response
 * compact.
 */
function groupByGenre<T extends { tags: string[]; _tier1: number }>(
  items: T[],
): ForYouGenrePole<T>[] {
  const poleMap = new Map<string, T[]>();
  for (const item of items) {
    const genre = item.tags[0] ?? "all";
    if (!poleMap.has(genre)) poleMap.set(genre, []);
    poleMap.get(genre)!.push(item);
  }

  if (poleMap.size === 0) {
    return [{ genre: "all", items: [] }];
  }

  // Order poles by total overlap signal (user's library relevance) descending.
  const poles: ForYouGenrePole<T>[] = [...poleMap.entries()]
    .map(([genre, genreItems]) => ({
      genre,
      items: genreItems,
      _signal: genreItems.reduce((acc, it) => acc + it._tier1, 0),
    }))
    .sort((a, b) => b._signal - a._signal)
    .map(({ genre, items: genreItems }) => ({ genre, items: genreItems }));

  // Append "all" summary pole when there are multiple genre poles.
  if (poleMap.size > 1) {
    poles.push({ genre: "all", items: [...items] });
  }
  return poles;
}
