/**
 * Bounded, listener-facing broadcast discovery read model.  This intentionally
 * stays plain JSON: it composes persisted station facts and schedule evidence,
 * rather than becoming another generated CRUD resource.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";
import { getUserForListenerRead } from "../lore/userSession.js";
import { coarseUsCityLocation, distanceMiles, isNearbyRadius, resolveUsZip, usableCoordinates } from "../lore/station-location.js";
import {
  CATALOG_LENSES,
  CATALOG_FORMATS,
  CATALOG_DECADES,
  CATALOG_SORTS,
  CATALOG_STATION_TYPES,
  CATALOG_PLAYING_NOW,
  composeStationCatalog,
  type CatalogFilters,
  type CatalogFormat,
  type CatalogDecade,
  type CatalogPlayingNow,
  type CatalogLens,
  type CatalogSort,
  type CatalogStation,
} from "../lore/station-catalog.js";
import { BRO_ZONES_REVIEWED } from "../lore/bro-zones-migration.js";

const router: IRouter = Router();
const MAX_LIMIT = 30;
const MODES = new Set(["location", "station", "artist", "genre", "newness", "library-crossing"]);
export type ExploreMode = "location" | "station" | "artist" | "genre" | "newness" | "library-crossing";
type CatalogDbRow = Record<string, unknown> & {
  slug: string;
  name: string;
  org: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  location_source: string | null;
  location_confidence: string | null;
  stream_url: string | null;
  active: boolean;
  hidden: boolean;
  crossing_eligible: boolean;
  station_class: string | null;
  tags: string[] | null;
  era_genre_mode: boolean;
  sleep_mode: boolean;
  discovery_score: number | null;
  library_crossings: number;
  library_artist_crossings: number;
  focused_artist_crossings: number;
  live: boolean;
  current_age_tier: CatalogPlayingNow | null;
  bro_zones: string[] | null;
  support: boolean;
  followed: boolean;
  sort_order: number | null;
};
type ExploreDbRow = Record<string, unknown> & {
  slug: string; name: string; city: string | null; region: string | null;
  latitude: number | null; longitude: number | null; discovery_score: number | null;
  artist_count: number; crossing_count: number; recent_profile: ExploreCandidate["recentProfile"];
  freshness_signal: ExploreCandidate["freshness"]; live: boolean;
  show_name: string | null; dj_name: string | null; start_time: string | null; end_time: string | null;
  upcoming_show_name: string | null; upcoming_dj_name: string | null;
  upcoming_starts_at: Date | string | null; upcoming_ends_at: Date | string | null;
  known_show_name: string | null; known_dj_name: string | null; known_last_aired_at: Date | string | null;
};

export interface ExploreCandidate {
  station: { slug: string; name: string; city: string | null; region: string | null; latitude: number | null; longitude: number | null };
  show: { name: string; djName: string | null; startsAt: string | null; endsAt: string | null; live: boolean } | null;
  recentProfile: { readinessTier?: string; top?: Array<{ genre: string; count: number }> } | null;
  freshness: { hasRecentUsableSpin?: boolean } | null;
  discoveryScore: number | null;
  artistCount: number;
  crossingCount: number;
  exactGenre: boolean;
  adjacentGenre: boolean;
  upcoming?: { name: string; djName: string | null; startsAt: string; endsAt: string } | null;
  knownShow?: { name: string; djName: string | null; lastAiredAt: string } | null;
}

/** Pure, deliberately legible ordering shared by route tests. */
export function composeExplore(
  candidates: ExploreCandidate[],
  mode: ExploreMode,
  limit: number,
  origin?: ReturnType<typeof resolveUsZip> | null,
) {
  const reason = (c: ExploreCandidate) => {
    if (mode === "artist") return c.artistCount > 0 ? { kind: "artist_exact", text: "Recent resolved plays match this artist." } : { kind: "artist_unavailable", text: "No recent exact artist evidence." };
    if (mode === "genre") return c.exactGenre ? { kind: "genre_exact", text: "Recent profile contains this genre." } : { kind: "genre_adjacent", text: "Recent profile has an adjacent genre." };
    if (mode === "library-crossing") return { kind: "library_crossing", text: "A saved track played here in the last 24 hours." };
    if (mode === "newness") return { kind: "recent_rotation", text: "Recent station profile is available." };
    if (mode === "location") return { kind: "nearby_station", text: "Station base is near the supplied ZIP." };
    return { kind: "station_match", text: "Matches the requested station." };
  };
  return candidates
    .map((c) => {
      const distance = origin && usableCoordinates(c.station.latitude, c.station.longitude)
        ? Math.round(distanceMiles(origin, { latitude: c.station.latitude, longitude: c.station.longitude as number }) * 10) / 10 : null;
      const readiness = c.recentProfile?.readinessTier ?? "insufficient";
      return {
        station: { ...c.station, approximateDistanceMiles: distance },
        show: c.show,
        primaryReason: reason(c),
        evidence: { artistRecentPlays: c.artistCount, libraryCrossings24h: c.crossingCount, genreMatch: c.exactGenre ? "exact" : c.adjacentGenre ? "adjacent" : "aggregate", profileGenres: c.recentProfile?.top?.slice(0, 3) ?? [] },
        readiness,
        confidence: c.show?.live ? (c.show.name ? "schedule_attributed" : "station_only") : readiness === "ready" ? "high" : "limited",
        timing: c.show ? { startsAt: c.show.startsAt, endsAt: c.show.endsAt, isLive: c.show.live } : null,
      };
    })
    .sort((a, b) => {
      const ca = candidates.find((c) => c.station.slug === a.station.slug)!;
      const cb = candidates.find((c) => c.station.slug === b.station.slug)!;
      const score =
        mode === "artist" ? cb.artistCount - ca.artistCount :
        mode === "library-crossing" ? cb.crossingCount - ca.crossingCount :
        mode === "genre" ? Number(cb.exactGenre) - Number(ca.exactGenre) :
        mode === "newness" ? (cb.discoveryScore ?? -1) - (ca.discoveryScore ?? -1) :
        mode === "location" ? (a.station.approximateDistanceMiles ?? Infinity) - (b.station.approximateDistanceMiles ?? Infinity) :
        0;
      return score || Number(Boolean(cb.show?.live)) - Number(Boolean(ca.show?.live)) || a.station.name.localeCompare(b.station.name);
    })
    .slice(0, limit);
}

function csvQuery(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean))];
}

const SAFE_FOLLOWED_SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

/**
 * Device-local follows have no server identity.  When the client asks for
 * followed-only results it must send the complete, authoritative slug set;
 * never accept arbitrary SQL-ish values or silently treat a missing set as
 * "all stations".
 */
function parseFollowedSlugs(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  if (value.trim() === "") return [];
  const slugs = [...new Set(value.split(",").map((slug) => slug.trim().toLowerCase()))];
  if (slugs.some((slug) => !slug || !SAFE_FOLLOWED_SLUG.test(slug)) || slugs.length > 500) return null;
  return slugs;
}

function normalizeDecadeFilter(values: string[]): CatalogDecade[] | null {
  const normalized = values.map((value) => value
    .replace(/^decade[:=-]?/, "")
    .replace(/^era[:=-]?/, ""));
  if (normalized.some((value) => !CATALOG_DECADES.includes(value as CatalogDecade))) return null;
  return normalized as CatalogDecade[];
}

function parseOffset(value: unknown): number | null {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

function encodeCatalogCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCatalogCursor(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 200) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown };
    return parseOffset(parsed.offset);
  } catch {
    return null;
  }
}

function catalogRowToStation(row: CatalogDbRow): CatalogStation {
  return {
    slug: row.slug,
    name: row.name,
    org: row.org,
    city: row.city,
    region: row.region,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    locationSource: row.location_source,
    locationConfidence: row.location_confidence,
    streamUrl: row.stream_url,
    active: row.active,
    hidden: row.hidden,
    crossingEligible: row.crossing_eligible,
    stationClass: row.station_class,
    tags: Array.isArray(row.tags) ? row.tags : [],
    eraGenreMode: row.era_genre_mode,
    sleepMode: row.sleep_mode,
    discoveryScore: row.discovery_score == null ? null : Number(row.discovery_score),
    libraryCrossings: Number(row.library_crossings ?? 0),
    libraryArtistCrossings: Number(row.library_artist_crossings ?? 0),
    focusedArtistCrossings: Number(row.focused_artist_crossings ?? 0),
    live: Boolean(row.live),
    currentAgeTier: row.current_age_tier as CatalogPlayingNow | null,
    broZones: Array.isArray(row.bro_zones) ? row.bro_zones : [],
    support: Boolean(row.support),
    followed: Boolean(row.followed),
    sortOrder: row.sort_order == null ? null : Number(row.sort_order),
  };
}

/**
 * Unified listener station catalog.  This is intentionally an /explore
 * variant rather than a second stations directory: operational station routes
 * keep ownership of playback, now-playing, and hidden mode pools.
 */
async function handleCatalog(req: Request, res: Response) {
  const rawLens = typeof req.query.lens === "string" ? req.query.lens.trim().toLowerCase() : "";
  const rawMode = typeof req.query.mode === "string" ? req.query.mode.trim().toLowerCase() : "";
  const lensValue = rawLens || (CATALOG_LENSES.includes(rawMode as CatalogLens) ? rawMode : "");
  if (!CATALOG_LENSES.includes(lensValue as CatalogLens)) {
    return res.status(400).json({ code: "invalid_lens", error: "lens must be local, for-you, or all." });
  }
  const lens = lensValue as CatalogLens;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return res.status(400).json({ code: "invalid_limit", error: `limit must be an integer from 1 to ${MAX_LIMIT}.` });
  }
  const radiusMiles = typeof req.query.radiusMiles === "string" ? Number(req.query.radiusMiles) : 50;
  if (!isNearbyRadius(radiusMiles)) {
    return res.status(400).json({ code: "invalid_radius", error: "radiusMiles must be 25, 50, 100, or 250." });
  }
  const sortValue = typeof req.query.sort === "string" ? req.query.sort.trim().toLowerCase() : "recommended";
  if (!CATALOG_SORTS.includes(sortValue as CatalogSort)) {
    return res.status(400).json({ code: "invalid_sort", error: "sort must be recommended, nearest, best-match, rarest-crossing, live-now, or name." });
  }
  const sort = sortValue as CatalogSort;
  if ((sort === "nearest" && lens !== "local") ||
      ((sort === "best-match" || sort === "rarest-crossing") && lens !== "for-you")) {
    return res.status(400).json({ code: "invalid_sort_for_lens", error: `sort "${sort}" is not available for the ${lens} lens.` });
  }

  const decadeValues = normalizeDecadeFilter(csvQuery(req.query.decade));
  if (decadeValues === null) {
    return res.status(400).json({ code: "invalid_decade", error: "decade filters must be explicit values such as 1980s." });
  }
  const stationTypes = csvQuery(req.query.stationType || req.query.type);
  if (stationTypes.some((value) => !CATALOG_STATION_TYPES.includes(value as (typeof CATALOG_STATION_TYPES)[number]))) {
    return res.status(400).json({ code: "invalid_station_type", error: "stationType contains an unsupported editorial category." });
  }
  const formats = csvQuery(req.query.format || req.query.specialistFormat);
  if (formats.some((value) => !CATALOG_FORMATS.includes(value as CatalogFormat))) {
    return res.status(400).json({ code: "invalid_format", error: "format contains an unsupported Specialist format." });
  }
  const playingNow = csvQuery(req.query.playing);
  if (playingNow.some((value) => !CATALOG_PLAYING_NOW.includes(value as CatalogPlayingNow))) {
    return res.status(400).json({ code: "invalid_playing", error: "playing filters must be first, current, catalog, or deep." });
  }
  const collection = typeof req.query.collection === "string" ? req.query.collection.trim().toLowerCase() : "";
  if (collection && collection !== "bro-zones") {
    return res.status(400).json({ code: "invalid_collection", error: "collection must be bro-zones." });
  }
  const broZones = csvQuery(req.query.broZones || req.query.zone || req.query.broZone || req.query.zones);
  if (broZones.some((zone) => !BRO_ZONES_REVIEWED.includes(zone as (typeof BRO_ZONES_REVIEWED)[number]))) {
    return res.status(400).json({ code: "invalid_bro_zone", error: "zone contains an unsupported Bro Zone." });
  }
  const followedOnly = ["1", "true"].includes(String(req.query.followed ?? "").toLowerCase());
  const supportOnly = ["1", "true"].includes(String(req.query.support ?? "").toLowerCase());
  const followedSlugs = followedOnly
    ? parseFollowedSlugs(req.query.followedSlugs ?? req.query.followedStations)
    : null;
  if (followedOnly && followedSlugs === null) {
    return res.status(400).json({
      code: "missing_followed_slugs",
      error: "followed filtering requires the complete comma-separated followedSlugs list.",
    });
  }
  const offsetValue = parseOffset(req.query.offset);
  if (offsetValue === null) {
    return res.status(400).json({ code: "invalid_offset", error: "offset must be a non-negative integer no greater than 100000." });
  }
  const cursorOffset = req.query.cursor == null ? null : decodeCatalogCursor(req.query.cursor);
  if (req.query.cursor != null && cursorOffset === null) {
    return res.status(400).json({ code: "invalid_cursor", error: "cursor is invalid or expired." });
  }
  if (req.query.cursor != null && req.query.offset != null) {
    return res.status(400).json({ code: "invalid_pagination", error: "use either cursor or offset, not both." });
  }
  const filters: CatalogFilters = {
    stationTypes: stationTypes as CatalogFilters["stationTypes"],
    formats: formats as CatalogFormat[],
    decades: decadeValues,
    playingNow: playingNow as CatalogPlayingNow[],
    broZones,
    broZonesCollectionOnly: collection === "bro-zones",
    followedOnly,
    supportOnly,
  };

  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const region = typeof req.query.region === "string" ? req.query.region.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "US";
  const origin = zip
    ? resolveUsZip(zip)
    : city && region
      ? (() => {
        const coarse = coarseUsCityLocation({ city, region, country });
        return coarse && usableCoordinates(coarse.latitude, coarse.longitude)
          ? { city, region, country: "US" as const, latitude: coarse.latitude, longitude: coarse.longitude as number }
          : null;
      })()
      : null;
  if (lens === "local" && !origin) {
    return res.status(400).json({ code: "invalid_locality", error: "local lens requires a known US ZIP or city and state." });
  }

  const user = lens === "for-you" ? await getUserForListenerRead(req) : null;
  const focusedArtist = typeof req.query.artist === "string" ? req.query.artist.trim() : "";
  if (focusedArtist.length > 100) {
    return res.status(400).json({ code: "invalid_artist", error: "artist focus must be at most 100 characters." });
  }
  if (focusedArtist && lens !== "for-you") {
    return res.status(400).json({ code: "invalid_artist_lens", error: "artist focus is only available on the For You lens." });
  }
  const crossingSql = user ? sql`
    (SELECT count(*)::int FROM spins sp
      JOIN library_items li ON li.mbid=sp.mbid
      WHERE sp.station_id=s.id AND li.user_id=${user.id} AND li.removed_at IS NULL
        AND sp.played_at >= now()-interval '90 days')` : sql`0`;
  const artistCrossingSql = user ? sql`
    (SELECT count(*)::int FROM spins sp
      JOIN recordings r ON r.mbid=sp.mbid
      WHERE sp.station_id=s.id
        AND NOT EXISTS (
          SELECT 1 FROM library_items exact_li
          WHERE exact_li.user_id=${user.id} AND exact_li.mbid=sp.mbid
            AND exact_li.removed_at IS NULL
        )
        AND (
          (r.artist_mbid IS NOT NULL AND EXISTS (
            SELECT 1
            FROM library_items artist_li
            JOIN recordings library_recording ON library_recording.mbid=artist_li.mbid
            WHERE artist_li.user_id=${user.id} AND artist_li.removed_at IS NULL
              AND library_recording.artist_mbid=r.artist_mbid
          ))
          OR lower(trim(r.artist)) IN (
            SELECT lower(trim(artist)) FROM spotify_library_items
            WHERE user_id=${user.id} AND mbid IS NULL AND removed_at IS NULL
          )
          OR lower(trim(r.artist)) IN (
            SELECT lower(trim(artist_name)) FROM taste_seeds
            WHERE user_id=${user.id}
          )
        )
        AND sp.played_at >= now()-interval '90 days')` : sql`0`;
  const focusedArtistCrossingSql = user && focusedArtist ? sql`
    (SELECT count(*)::int
       FROM spins focused_sp
       JOIN recordings focused_recording ON focused_recording.mbid=focused_sp.mbid
      WHERE focused_sp.station_id=s.id
        AND focused_sp.played_at >= now()-interval '90 days'
        AND (
          lower(trim(focused_recording.artist))=lower(trim(${focusedArtist}))
          OR focused_recording.artist_mbid=${focusedArtist}
        ))` : sql`0`;
  // The latest-spin and prior-spin lookups are among the most expensive parts
  // of this catalog query. They are only observable through the playing-now
  // filter or the live-now sort; the default recommended catalog must not pay
  // that cost for every station.
  const needsNowPlayingEvidence = playingNow.length > 0 || sort === "live-now";
  const currentTrackSelect = needsNowPlayingEvidence
    ? sql`current_track.age_tier`
    : sql`NULL::text`;
  const liveSelect = needsNowPlayingEvidence
    ? sql`EXISTS (
        SELECT 1 FROM spins current_spin
        WHERE current_spin.station_id=s.id
          AND COALESCE(current_spin.observed_at, current_spin.created_at) >= now()-interval '15 minutes'
      )`
    : sql`false`;
  const currentTrackJoin = needsNowPlayingEvidence ? sql`
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN r.release_year IS NULL THEN NULL
        WHEN NOT EXISTS (
          SELECT 1 FROM spins prior
          WHERE prior.mbid=latest.mbid AND prior.played_at < latest.played_at
        ) AND r.release_year >= EXTRACT(YEAR FROM now())::int THEN 'first'
        WHEN (EXTRACT(YEAR FROM now())::int-r.release_year)*12 <= 18 THEN 'current'
        WHEN (EXTRACT(YEAR FROM now())::int-r.release_year)*12 <= 60 THEN 'catalog'
        ELSE 'deep'
      END AS age_tier
      FROM spins latest
      JOIN recordings r ON r.mbid=latest.mbid
      WHERE latest.station_id=s.id
        AND COALESCE(latest.observed_at, latest.created_at) >= now()-interval '15 minutes'
      ORDER BY COALESCE(latest.observed_at, latest.created_at) DESC, latest.id DESC
      LIMIT 1
    ) current_track ON true
  ` : sql``;
  const rows = await db.execute<CatalogDbRow>(sql`
    SELECT s.*,
      ${crossingSql} AS library_crossings,
      ${artistCrossingSql} AS library_artist_crossings,
      ${focusedArtistCrossingSql} AS focused_artist_crossings,
      COALESCE((
        SELECT array_agg(DISTINCT scm.zone ORDER BY scm.zone)
        FROM station_collection_memberships scm
        JOIN station_collections sc ON sc.id=scm.collection_id
        WHERE scm.station_id=s.id AND sc.slug='bro-zones' AND scm.zone IS NOT NULL
      ), ARRAY[]::text[]) AS bro_zones,
      (NULLIF(trim(COALESCE(s.donate_url, '')), '') IS NOT NULL
        OR NULLIF(trim(COALESCE(s.store_url, '')), '') IS NOT NULL) AS support,
      false AS followed,
      ${currentTrackSelect} AS current_age_tier,
      ${liveSelect} AS live
    FROM stations s
    ${currentTrackJoin}
    WHERE s.active=true AND s.hidden=false AND s.crossing_eligible=true
      AND s.stream_url IS NOT NULL AND s.stream_url <> ''
    ORDER BY s.sort_order ASC NULLS LAST, s.name ASC, s.slug ASC
  `);
  const followedSet = followedSlugs === null ? null : new Set(followedSlugs);
  const composed = composeStationCatalog(
    rows.rows
      .map(catalogRowToStation)
      .map((station) => ({
        ...station,
        followed: followedSet ? followedSet.has(station.slug.toLowerCase()) : false,
      }))
      .filter((station) => !followedOnly || station.followed === true),
    lens,
    filters,
    sort,
    origin,
    radiusMiles,
    limit,
    cursorOffset ?? offsetValue,
  );
  const stations = composed.items.map((item) => ({
    station: {
      slug: item.station.slug,
      name: item.station.name,
      org: item.station.org ?? null,
      city: item.station.city,
      region: item.station.region,
      country: item.station.country ?? null,
      streamUrl: item.station.streamUrl ?? null,
      stationType: item.stationType,
      formats: item.formats,
      decades: item.decades,
      broZones: item.station.broZones ?? [],
      support: item.station.support === true,
      followed: item.station.followed === true,
      currentAgeTier: item.station.currentAgeTier ?? null,
    },
    proximity: item.proximity,
    evidence: item.evidence,
    score: item.score,
    explanation: lens === "local"
      ? item.proximity.verified
        ? `${item.proximity.distanceMiles} miles from the supplied locality.`
        : "No verified station-base location."
      : lens === "for-you"
        ? focusedArtist
          ? item.evidence.focusedArtistCrossings > 0
            ? `${item.evidence.focusedArtistCrossings} recent play${item.evidence.focusedArtistCrossings === 1 ? "" : "s"} for ${focusedArtist}.`
            : `No recent play evidence for ${focusedArtist}; shown as an eligible fallback.`
          : item.evidence.libraryCrossings > 0
          ? `${item.evidence.libraryCrossings} Library crossing${item.evidence.libraryCrossings === 1 ? "" : "s"} in the last 90 days.`
          : "No Library crossing evidence yet; shown as an eligible fallback."
        : "Eligible catalog station; no personalized ranking claim.",
  }));
  return res.json({
    stations,
    items: stations,
    total: composed.composition.eligibleCount,
    nextCursor: (cursorOffset ?? offsetValue) + composed.items.length < composed.composition.eligibleCount
      ? encodeCatalogCursor((cursorOffset ?? offsetValue) + composed.items.length)
      : null,
    metadata: {
      ...composed.composition,
      locality: origin ? { city: origin.city, region: origin.region, country: origin.country } : null,
      radiusMiles: lens === "local" ? radiusMiles : null,
      personalCrossings: Boolean(user),
      focusedArtist: focusedArtist || null,
      followedSource: followedOnly ? "client-authoritative-slugs" : null,
      pagination: {
        total: composed.composition.eligibleCount,
        offset: cursorOffset ?? offsetValue,
        limit,
        nextCursor: (cursorOffset ?? offsetValue) + composed.items.length < composed.composition.eligibleCount
          ? encodeCatalogCursor((cursorOffset ?? offsetValue) + composed.items.length)
          : null,
      },
    },
  });
}

router.get("/explore", h(async (req, res) => {
  if (typeof req.query.lens === "string" ||
      (typeof req.query.mode === "string" && CATALOG_LENSES.includes(req.query.mode.trim().toLowerCase() as CatalogLens))) {
    return handleCatalog(req, res);
  }
  const toIso = (value: Date | string) => value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  const mode = typeof req.query.mode === "string" ? req.query.mode : "";
  if (!MODES.has(mode)) return res.status(400).json({ code: "invalid_mode", error: "mode must be location, station, artist, genre, newness, or library-crossing." });
  const typedMode = mode as ExploreMode;
  const limitInput = typeof req.query.limit === "string" ? Number(req.query.limit) : 12;
  if (!Number.isInteger(limitInput) || limitInput < 1 || limitInput > MAX_LIMIT) return res.status(400).json({ code: "invalid_limit", error: `limit must be an integer from 1 to ${MAX_LIMIT}.` });
  const station = typeof req.query.station === "string" ? req.query.station.trim() : "";
  const term = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (station.length > 100 || term.length > 100 || ((typedMode === "artist" || typedMode === "genre") && !term)) return res.status(400).json({ code: "invalid_constraint", error: "A bounded q is required for artist and genre modes." });
  if (typedMode === "station" && !station) return res.status(400).json({ code: "invalid_station", error: "station mode requires a station slug." });
  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  const origin = zip ? resolveUsZip(zip) : null;
  if (typedMode === "location" && !origin) return res.status(400).json({ code: "invalid_zip", error: "location mode requires a known 5-digit US ZIP." });
  const radiusInput = typeof req.query.radiusMiles === "string" ? Number(req.query.radiusMiles) : 50;
  if (typedMode === "location" && !isNearbyRadius(radiusInput)) return res.status(400).json({ code: "invalid_radius", error: "radiusMiles must be 25, 50, 100, or 250." });
  const user = typedMode === "library-crossing" ? await getUserForListenerRead(req) : null;

  // The CTE selects at most one current schedule slot and one genuinely future
  // slot per station.  A live slot can therefore never leak into comingUp.
  const artistPredicate = typedMode === "artist" ? sql`
    (SELECT count(*)::int FROM spins sp JOIN recordings r ON r.mbid=sp.mbid
     WHERE sp.station_id=s.id AND sp.played_at >= now()-interval '90 days'
       AND (lower(r.artist)=lower(${term}) OR r.artist_mbid=${term}))` : sql`0`;
  const crossingPredicate = user ? sql`
    (SELECT count(*)::int FROM spins sp JOIN library_items li ON li.mbid=sp.mbid
     WHERE sp.station_id=s.id AND li.user_id=${user.id} AND li.removed_at IS NULL
       AND sp.played_at >= now()-interval '24 hours')` : sql`0`;
  const rows = await db.execute<ExploreDbRow>(sql`
    WITH base AS (
      SELECT s.*, ${artistPredicate} AS artist_count, ${crossingPredicate} AS crossing_count,
        live_slot.show_name, live_slot.dj_name, live_slot.start_time, live_slot.end_time,
        future_slot.show_name AS upcoming_show_name, future_slot.dj_name AS upcoming_dj_name,
        future_slot.starts_at AS upcoming_starts_at, future_slot.ends_at AS upcoming_ends_at,
        known_slot.show_name AS known_show_name, known_slot.dj_name AS known_dj_name,
        known_slot.last_aired_at AS known_last_aired_at,
        live_slot.show_name IS NOT NULL AS live
      FROM stations s
      LEFT JOIN LATERAL (
        SELECT show_name, dj_name, start_time, end_time FROM scraped_shows
        WHERE station_id=s.id AND voided_at IS NULL
          AND (
            (day_of_week=to_char(now() at time zone s.iana_timezone, 'Dy') AND (
              (end_time > start_time AND start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI') AND end_time > to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
              OR (end_time < start_time AND start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
            ))
            OR (end_time < start_time
              AND day_of_week=to_char((now()-interval '1 day') at time zone s.iana_timezone, 'Dy')
              AND end_time > to_char(now() at time zone s.iana_timezone, 'HH24:MI'))
          )
        ORDER BY start_time DESC LIMIT 1
      ) live_slot ON true
      LEFT JOIN LATERAL (
        SELECT next_slot.show_name, next_slot.dj_name, next_slot.starts_at,
          next_slot.starts_at + CASE
            WHEN next_slot.end_time > next_slot.start_time
              THEN next_slot.end_time::time - next_slot.start_time::time
            ELSE interval '1 day' + next_slot.end_time::time - next_slot.start_time::time
          END AS ends_at
        FROM (
          SELECT ss.show_name, ss.dj_name, ss.start_time, ss.end_time,
            (
              date_trunc('day', now() at time zone s.iana_timezone)
              + (
                (
                  CASE ss.day_of_week
                    WHEN 'Sun' THEN 0 WHEN 'Mon' THEN 1 WHEN 'Tue' THEN 2
                    WHEN 'Wed' THEN 3 WHEN 'Thu' THEN 4 WHEN 'Fri' THEN 5
                    WHEN 'Sat' THEN 6
                  END
                  - extract(dow from now() at time zone s.iana_timezone)::int + 7
                ) % 7
                + CASE
                    WHEN ss.day_of_week=to_char(now() at time zone s.iana_timezone, 'Dy')
                      AND ss.start_time <= to_char(now() at time zone s.iana_timezone, 'HH24:MI')
                    THEN 7 ELSE 0
                  END
              ) * interval '1 day'
              + ss.start_time::time
            ) at time zone s.iana_timezone AS starts_at
          FROM scraped_shows ss
          WHERE ss.station_id=s.id AND ss.voided_at IS NULL AND ss.end_time <> ss.start_time
        ) next_slot
        ORDER BY next_slot.starts_at ASC LIMIT 1
      ) future_slot ON true
      LEFT JOIN LATERAL (
        SELECT sp.show_id
        FROM spins sp
        WHERE sp.station_id=s.id
          AND sp.show_id IS NOT NULL
          AND live_slot.show_name IS NOT NULL
          AND sp.played_at >= (
            date_trunc('day', now() at time zone s.iana_timezone)
            + live_slot.start_time::time
            - CASE
                WHEN live_slot.end_time < live_slot.start_time
                  AND to_char(now() at time zone s.iana_timezone, 'HH24:MI') < live_slot.end_time
                THEN interval '1 day'
                ELSE interval '0'
              END
          ) at time zone s.iana_timezone
          AND sp.played_at <= now()
        ORDER BY sp.played_at DESC, sp.id DESC
        LIMIT 1
      ) active_show ON true
      LEFT JOIN LATERAL (
        SELECT sh.name AS show_name, sh.dj_name, max(sp.played_at) AS last_aired_at
        FROM shows sh
        JOIN spins sp ON sp.show_id=sh.id
        WHERE sh.station_id=s.id
          AND sh.id IS DISTINCT FROM active_show.show_id
        GROUP BY sh.id, sh.name, sh.dj_name
        ORDER BY max(sp.played_at) DESC LIMIT 1
      ) known_slot ON true
      WHERE s.active=true AND s.hidden=false ${station ? sql`AND s.slug=${station}` : sql``}
    ), ranked AS (
      SELECT *, row_number() over (partition by id order by live desc nulls last, start_time asc nulls last) rn FROM base
    )
    SELECT * FROM ranked WHERE rn=1 ORDER BY id
  `);
  const candidates: ExploreCandidate[] = rows.rows.map((r) => {
    const top = r.recent_profile?.top ?? [];
    const query = term.toLowerCase();
    const exactGenre = typedMode === "genre" && top.some((g) => g.genre.toLowerCase() === query);
    const adjacentGenre = typedMode === "genre" && !exactGenre && top.some((g) => g.genre.toLowerCase().includes(query) || query.includes(g.genre.toLowerCase()));
    return { station: { slug: r.slug, name: r.name, city: r.city, region: r.region, latitude: r.latitude, longitude: r.longitude }, show: r.live && r.show_name ? { name: r.show_name, djName: r.dj_name, startsAt: r.start_time, endsAt: r.end_time, live: true } : null, upcoming: r.upcoming_show_name && r.upcoming_starts_at && r.upcoming_ends_at ? { name: r.upcoming_show_name, djName: r.upcoming_dj_name, startsAt: toIso(r.upcoming_starts_at), endsAt: toIso(r.upcoming_ends_at) } : null, knownShow: r.known_show_name && r.known_last_aired_at ? { name: r.known_show_name, djName: r.known_dj_name, lastAiredAt: toIso(r.known_last_aired_at) } : null, recentProfile: r.recent_profile ?? null, freshness: r.freshness_signal ?? null, discoveryScore: r.discovery_score == null ? null : Number(r.discovery_score), artistCount: Number(r.artist_count), crossingCount: Number(r.crossing_count), exactGenre, adjacentGenre };
  });
  const filtered = typedMode === "genre" ? candidates.filter((c) => c.exactGenre || c.adjacentGenre)
    : typedMode === "artist" ? candidates.filter((c) => c.artistCount > 0)
      : typedMode === "library-crossing" ? candidates.filter((c) => c.crossingCount > 0)
        : typedMode === "newness" ? candidates.filter((c) => c.freshness?.hasRecentUsableSpin === true)
        : typedMode === "location" && origin ? candidates.filter((c) =>
          usableCoordinates(c.station.latitude, c.station.longitude) &&
          distanceMiles(origin, { latitude: c.station.latitude, longitude: c.station.longitude as number }) <= radiusInput
        ) : candidates;
  const items = composeExplore(filtered, typedMode, limitInput, origin);
  const onAirNow = items.filter((i) => i.timing?.isLive);
  // Current live occurrence is excluded; schedule future entries are unavailable
  // when schedule evidence was not returned, and that absence is explicit.
  const comingUp = filtered
    .flatMap((candidate) => {
      if (!candidate.upcoming) return [];
      // Recompose with an explicitly future occurrence, preserving the live
      // card only in onAirNow rather than duplicating its current slot.
      return composeExplore([{ ...candidate, show: { ...candidate.upcoming, live: false } }], typedMode, 1, origin);
    })
    .sort((a, b) => {
      const at = a.timing?.startsAt ?? "";
      const bt = b.timing?.startsAt ?? "";
      return at.localeCompare(bt) || a.station.name.localeCompare(b.station.name);
    })
    .slice(0, limitInput);
  const showsToKnow = filtered
    .flatMap((candidate) => {
      if (!candidate.knownShow) return [];
      return composeExplore([{
        ...candidate,
        show: {
          name: candidate.knownShow.name,
          djName: candidate.knownShow.djName,
          startsAt: candidate.knownShow.lastAiredAt,
          endsAt: null,
          live: false,
        },
      }], typedMode, 1, origin);
    })
    .sort((a, b) => (b.timing?.startsAt ?? "").localeCompare(a.timing?.startsAt ?? ""))
    .slice(0, limitInput);
  return res.json({ onAirNow, comingUp, showsToKnow, stations: items, metadata: { mode: typedMode, radiusMiles: typedMode === "location" ? radiusInput : null, partial: { schedules: candidates.some((c) => !c.show), genreEnrichment: candidates.some((c) => !c.recentProfile), coordinates: origin ? candidates.some((c) => c.station.latitude == null || c.station.longitude == null) : false, personalCrossings: typedMode === "library-crossing" && !user }, locality: origin ? { city: origin.city, region: origin.region, country: origin.country } : null } });
}));

export default router;