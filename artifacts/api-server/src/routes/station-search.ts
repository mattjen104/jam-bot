/**
 * Station Finder — public Radio Browser search proxy.
 *
 * GET /api/stations/search?q=<query>&country=<country>&tag=<genre>
 *
 * Proxies the Radio Browser public directory
 * (https://de1.api.radio-browser.info/json/stations/search) so listeners can
 * find stations outside the curated Lore catalog and pin them to their
 * device-local personal list. No Lore account required; nothing is written
 * to the database — the only DB reads are the `inLoreCatalog` flags.
 *
 * Abuse guards:
 *   - q must be at least 2 characters (rejects spray/single-letter queries).
 *   - All params are length-capped and the upstream fetch has a hard timeout.
 *
 * `inLoreCatalog` is set when the station is already in the public Lore
 * catalog — matched by Radio Browser UUID (radio_browser_stations ↔ stations
 * join) or by case-insensitive name against active, non-hidden stations — so
 * the client can label it "Already in Lore" instead of offering a duplicate.
 *
 * Plain JSON (no orval/api-zod), same convention as the player read-models.
 */
import { Router, type IRouter, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, stationsTable, radioBrowserStationsTable } from "@workspace/db";
import { h } from "../middlewares/asyncHandler.js";
import {
  ZIP_DATASET,
  distanceMiles,
  isNearbyRadius,
  resolveUsZip,
  usableCoordinates,
} from "../lore/station-location.js";

const router: IRouter = Router();

const RB_SEARCH_URL = "https://de1.api.radio-browser.info/json/stations/search";
const RB_TIMEOUT_MS = 10_000;
const MAX_RESULTS = 30;
const MIN_QUERY_LEN = 2;
const MAX_PARAM_LEN = 100;
/** Per-IP budget for the public search proxy (requests per minute). */
const SEARCH_RATE_LIMIT = 20;
/** How long identical searches are served from the in-memory cache. */
const SEARCH_CACHE_TTL_MS = 60_000;
/** Hard cap on cached searches — bounds memory if keys spray. */
const SEARCH_CACHE_MAX_ENTRIES = 200;

/**
 * Per-IP rate limiter for the public proxy. Mounted before loreRouter, this
 * route is deliberately outside the admin catch-all's protection, so it
 * carries its own guard: 20 req/min per IP comfortably covers interactive
 * typing (debounced 400 ms) while capping how much upstream Radio Browser
 * fetch work — each holding a connection for up to RB_TIMEOUT_MS — a single
 * caller can force. `trust proxy` is set in app.ts so req.ip is the real
 * client address through the platform proxy.
 *
 * Factory-exported so tests can build a low-limit instance and prove the
 * 429 behavior; the default instance skips under VITEST because the unit
 * suite drives the same loopback IP through many scenarios (same pattern as
 * the ACR fingerprint limiter in lore/stations.ts).
 */
export function createStationSearchLimiter(limit: number) {
  return rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
}

const defaultSearchLimiter = createStationSearchLimiter(SEARCH_RATE_LIMIT);
const searchLimiterGuard: RequestHandler = (req, res, next) =>
  process.env["VITEST"] ? next() : defaultSearchLimiter(req, res, next);
router.use(["/stations/search", "/stations/nearby", "/stations/zip-origin"], searchLimiterGuard);

/**
 * Short-lived single-flight cache for identical searches. Stores the
 * in-flight PROMISE (trimmed upstream results, pre-catalog-flagging) so a
 * burst of identical queries collapses into one Radio Browser fetch. Errors
 * are never cached — a failed flight is evicted so the next request retries
 * (a 503 must not become a sticky negative result).
 */
interface SearchFlight {
  expiresAt: number;
  promise: Promise<StationSearchResult[]>;
}
const searchCache = new Map<string, SearchFlight>();

function searchCacheKey(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value.toLowerCase()}`)
    .join("\u001f");
}

function searchRadioBrowser(params: URLSearchParams): Promise<StationSearchResult[]> {
  const key = searchCacheKey(params);
  const now = Date.now();
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RB_TIMEOUT_MS);
  const promise = (async (): Promise<StationSearchResult[]> => {
    try {
      const rbRes = await fetch(`${RB_SEARCH_URL}?${params}`, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Lore-Radio/1.0", Accept: "application/json" },
      });
      if (!rbRes.ok) {
        throw new RadioBrowserError(`Radio Browser returned ${rbRes.status} — try again in a moment.`);
      }
      const data: unknown = await rbRes.json();
      if (!Array.isArray(data)) {
        throw new RadioBrowserError("Unexpected Radio Browser response.");
      }
      return (data as RbStation[])
        .map(trimRbStation)
        .filter((r): r is StationSearchResult => r !== null);
    } catch (err) {
      if (err instanceof RadioBrowserError) throw err;
      throw new RadioBrowserError("Radio Browser is unreachable right now — try again in a moment.");
    } finally {
      clearTimeout(timer);
    }
  })();

  // Evict on rejection so failures are never served from cache.
  promise.catch(() => searchCache.delete(key));
  if (searchCache.size >= SEARCH_CACHE_MAX_ENTRIES) {
    // Map iterates in insertion order — drop the oldest entries first.
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { expiresAt: now + SEARCH_CACHE_TTL_MS, promise });
  return promise;
}

class RadioBrowserError extends Error {}

/** Tests only: drop all cached flights so each test starts cold. */
export function __testOnlyResetStationSearchCache(): void {
  searchCache.clear();
}

/** Subset of the Radio Browser station object we read. */
interface RbStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  geo_lat?: number | null;
  geo_long?: number | null;
  geo_distance?: number | null;
  bitrate?: number;
  codec?: string;
}

export interface StationSearchResult {
  resultId: string;
  source: "catalog" | "radio_browser";
  catalogStationId: number | null;
  name: string;
  city: string | null;
  /** Radio Browser "state" (region/province) — the API has no city field. */
  state: string | null;
  region: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: string | null;
  locationConfidence: "verified" | "directory" | "coarse" | null;
  approximateDistanceMiles: number | null;
  tags: string[];
  url: string;
  favicon: string | null;
  bitrate: number | null;
  codec: string | null;
  radioBrowserUuid: string | null;
  inLoreCatalog: boolean;
}

function cleanString(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

function trimRbStation(s: RbStation): StationSearchResult | null {
  const name = s.name?.trim();
  const url = cleanString(s.url_resolved) ?? cleanString(s.url);
  const uuid = s.stationuuid?.trim();
  if (!name || !url || !uuid) return null;
  const hasLocation = usableCoordinates(s.geo_lat, s.geo_long);
  const latitude = hasLocation ? s.geo_lat as number : null;
  const longitude = hasLocation ? s.geo_long as number : null;
  return {
    resultId: `radio-browser:${uuid}`,
    source: "radio_browser",
    catalogStationId: null,
    name,
    city: null,
    state: cleanString(s.state),
    region: cleanString(s.state),
    country: cleanString(s.country),
    latitude,
    longitude,
    locationSource: hasLocation ? "radio_browser" : null,
    locationConfidence: hasLocation ? "directory" : null,
    approximateDistanceMiles: null,
    tags: (s.tags ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 8),
    url,
    favicon: cleanString(s.favicon),
    bitrate: typeof s.bitrate === "number" && s.bitrate > 0 ? s.bitrate : null,
    codec: cleanString(s.codec),
    radioBrowserUuid: uuid,
    inLoreCatalog: false,
  };
}

async function flagCatalogResults(results: StationSearchResult[]): Promise<void> {
  const uuids = [...new Set(results.flatMap((r) => r.radioBrowserUuid ? [r.radioBrowserUuid] : []))];
  const names = [...new Set(results.map((r) => r.name.toLowerCase()))];
  const [uuidRows, nameRows] = await Promise.all([
    uuids.length > 0
      ? db
          .select({ uuid: radioBrowserStationsTable.radioBrowserUuid })
          .from(radioBrowserStationsTable)
          .innerJoin(stationsTable, eq(radioBrowserStationsTable.stationId, stationsTable.id))
          .where(and(
            inArray(radioBrowserStationsTable.radioBrowserUuid, uuids),
            eq(stationsTable.active, true),
            eq(stationsTable.hidden, false),
          ))
      : Promise.resolve([] as { uuid: string }[]),
    names.length > 0
      ? db
          .select({ name: stationsTable.name })
          .from(stationsTable)
          .where(and(
            eq(stationsTable.active, true),
            eq(stationsTable.hidden, false),
            sql`lower(${stationsTable.name}) in (${sql.join(names.map((n) => sql`${n}`), sql`, `)})`,
          ))
      : Promise.resolve([] as { name: string }[]),
  ]);
  const catalogUuids = new Set(uuidRows.map((r) => r.uuid));
  const catalogNames = new Set(nameRows.map((r) => r.name.toLowerCase()));
  for (const result of results) {
    result.inLoreCatalog =
      (result.radioBrowserUuid != null && catalogUuids.has(result.radioBrowserUuid)) ||
      catalogNames.has(result.name.toLowerCase());
  }
}

function catalogResult(
  station: typeof stationsTable.$inferSelect,
  origin: NonNullable<ReturnType<typeof resolveUsZip>>,
): StationSearchResult | null {
  if (!usableCoordinates(station.latitude, station.longitude)) return null;
  const latitude = station.latitude;
  const longitude = station.longitude as number;
  return {
    resultId: `catalog:${station.id}`,
    source: "catalog",
    catalogStationId: station.id,
    name: station.name,
    city: station.city ?? null,
    state: station.region ?? null,
    region: station.region ?? null,
    country: station.country ?? null,
    latitude,
    longitude,
    locationSource: station.locationSource ?? null,
    locationConfidence:
      station.locationConfidence === "verified" ||
      station.locationConfidence === "directory" ||
      station.locationConfidence === "coarse"
        ? station.locationConfidence
        : null,
    approximateDistanceMiles: distanceMiles(origin, {
      latitude,
      longitude,
    }),
    tags: Array.isArray(station.tags) ? station.tags as string[] : [],
    url: station.streamUrl,
    favicon: station.logoUrl ?? null,
    bitrate: station.bitrate ?? null,
    codec: station.codec ?? null,
    radioBrowserUuid: null,
    inLoreCatalog: true,
  };
}

// GET /api/stations/zip-origin
// Resolves a request-scoped ZIP centroid for client-side sorting of the
// already-loaded curated catalog. The ZIP is never stored.
router.get("/stations/zip-origin", h(async (req, res) => {
  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ code: "invalid_zip", error: "Enter a 5-digit US ZIP code." });
  }
  const origin = resolveUsZip(zip);
  if (!origin) {
    return res.status(404).json({ code: "unknown_zip", error: "That ZIP code is not in the US location dataset." });
  }
  return res.json({
    origin,
    distanceMeaning: "Approximate straight-line distance from the ZIP centroid to where each station is based; not a reception-coverage claim.",
    dataset: ZIP_DATASET,
  });
}));

// GET /api/stations/nearby
router.get("/stations/nearby", h(async (req, res) => {
  const zip = typeof req.query.zip === "string" ? req.query.zip.trim() : "";
  if (!/^\d{5}$/.test(zip)) {
    return res.status(400).json({ code: "invalid_zip", error: "Enter a 5-digit US ZIP code." });
  }
  const origin = resolveUsZip(zip);
  if (!origin) {
    return res.status(404).json({ code: "unknown_zip", error: "That ZIP code is not in the US location dataset." });
  }
  const radiusMiles = Number(req.query.radiusMiles ?? 50);
  if (!isNearbyRadius(radiusMiles)) {
    return res.status(400).json({ code: "invalid_radius", error: "Radius must be 25, 50, 100, or 250 miles." });
  }

  const catalogRows = await db
    .select()
    .from(stationsTable)
    .where(and(
      eq(stationsTable.active, true),
      eq(stationsTable.hidden, false),
    ));
  const allCatalogLocated = catalogRows
    .map((station) => catalogResult(station, origin))
    .filter((station): station is StationSearchResult => station !== null);
  const catalogNearby = allCatalogLocated.filter(
    (station) => station.approximateDistanceMiles! <= radiusMiles,
  );

  const params = new URLSearchParams({
    geo_lat: String(origin.latitude),
    geo_long: String(origin.longitude),
    geo_distance: String(radiusMiles * 1.609344),
    countrycode: "US",
    limit: "100",
    hidebroken: "true",
    order: "clickcount",
    reverse: "true",
  });
  let directoryStatus: "available" | "unavailable" = "available";
  let directoryResults: StationSearchResult[] = [];
  try {
    directoryResults = (await searchRadioBrowser(params)).map((result) => {
      const approximateDistanceMiles = usableCoordinates(result.latitude, result.longitude)
        ? distanceMiles(origin, {
            latitude: result.latitude,
            longitude: result.longitude as number,
          })
        : null;
      return { ...result, approximateDistanceMiles };
    });
    await flagCatalogResults(directoryResults);
  } catch {
    directoryStatus = "unavailable";
  }
  const directoryLocated = directoryResults.filter(
    (station) =>
      station.approximateDistanceMiles != null &&
      station.approximateDistanceMiles <= radiusMiles,
  );
  const catalogNames = new Set(catalogNearby.map((station) => station.name.toLowerCase()));
  const results = [...catalogNearby, ...directoryLocated.filter(
    (station) => !station.inLoreCatalog && !catalogNames.has(station.name.toLowerCase()),
  )]
    .sort((a, b) =>
      (a.approximateDistanceMiles ?? Infinity) - (b.approximateDistanceMiles ?? Infinity) ||
      a.name.localeCompare(b.name),
    )
    .slice(0, 60)
    .map((station) => ({
      ...station,
      approximateDistanceMiles: station.approximateDistanceMiles == null
        ? null
        : Math.round(station.approximateDistanceMiles * 10) / 10,
    }));

  return res.json({
    origin,
    radiusMiles,
    distanceMeaning: "Approximate straight-line distance from the ZIP centroid to where the station is based; not a reception-coverage claim.",
    directoryStatus,
    coverage: {
      catalogTotal: catalogRows.length,
      catalogLocated: allCatalogLocated.length,
      catalogExcludedUnknownLocation: catalogRows.length - allCatalogLocated.length,
      catalogInsideRadius: catalogNearby.length,
      directoryReturned: directoryResults.length,
      directoryLocated: directoryResults.filter((station) => station.approximateDistanceMiles != null).length,
      directoryExcludedUnknownLocation: directoryResults.filter((station) => station.approximateDistanceMiles == null).length,
    },
    dataset: ZIP_DATASET,
    results,
  });
}));

// GET /api/stations/search
router.get("/stations/search", h(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < MIN_QUERY_LEN) {
    return res.status(400).json({ error: `Query too short — q must be at least ${MIN_QUERY_LEN} characters.` });
  }
  if (q.length > MAX_PARAM_LEN) {
    return res.status(400).json({ error: "Query too long." });
  }
  const country = (typeof req.query.country === "string" ? req.query.country.trim() : "").slice(0, MAX_PARAM_LEN);
  const tag = (typeof req.query.tag === "string" ? req.query.tag.trim() : "").slice(0, MAX_PARAM_LEN);

  const params = new URLSearchParams({
    name: q,
    limit: String(MAX_RESULTS),
    hidebroken: "true",
    order: "votes",
    // Radio Browser orders ascending by default; reverse so the most-voted
    // (most reliable) stations come first.
    reverse: "true",
  });
  if (country) params.set("country", country);
  if (tag) params.set("tag", tag);

  let results: StationSearchResult[];
  try {
    // Copy out of the (shared, cached) array — the inLoreCatalog flagging
    // below mutates rows and must stay per-request.
    results = (await searchRadioBrowser(params)).map((r) => ({ ...r, tags: [...r.tags] }));
  } catch (err) {
    const message = err instanceof RadioBrowserError
      ? err.message
      : "Radio Browser is unreachable right now — try again in a moment.";
    return res.status(502).json({ error: message });
  }

  // Flag results that are already in the public Lore catalog (active and not
  // hidden): by Radio Browser UUID via the enrollment table, or by
  // case-insensitive name match.
  await flagCatalogResults(results);

  return res.json({ results });
}));

export default router;
