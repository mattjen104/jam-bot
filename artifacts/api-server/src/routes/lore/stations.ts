import { Router, type IRouter } from "express";
import { rateLimit } from "express-rate-limit";
import {
  ListStationsResponse,
  ListStationsNowPlayingResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
  GetStationArchiveParams,
  GetStationArchiveResponse,
  GetStationSpinsQueryParams,
  GetStationSpinsResponse,
  GetStationPickerOverlapsParams,
  GetStationPickerOverlapsResponse,
  GetStationsRecentSpinsResponse,
  GetStationsScheduleResponse,
  GetStationUpcomingScheduleParams,
  GetStationUpcomingScheduleResponse,
  ReportStationNowPlayingParams,
  IcecastReportBody,
  IcecastReportResultBody,
  GetStationInsightsParams,
  GetStationInsightsResponse,
  GetStationsRollingGenresResponse,
  GetStationsArtistFrequencyResponse,
  GetStationsPopularArtistsResponse,
  GetStationsRecentArtistsResponse,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  pickersTable,
  picksTable,
  scrapedShowsTable,
  stationQualityTable,
} from "@workspace/db";
import { eq, ne, and, or, asc, desc, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl } from "../../lore/adapters.js";
import { inferTimezone } from "../../lore/timezone.js";
import { h } from "../../middlewares/asyncHandler.js";
import {
  toStation,
  toNowPlaying,
  toArchiveRecording,
  spinDayExpr,
  pickerNotOptedOut,
  validScheduleShowAttribution,
} from "./shared.js";
import { resolveAutomationClass } from "../../lore/scraped-shows-sync.js";
import { getUserFromSession } from "../../lore/userSession.js";
import { buildLibraryHitContext, checkLibraryHit, EMPTY_HIT_CONTEXT } from "../../lore/library-hits.js";
import { spinRunIdExpr } from "../../lore/runs.js";
import { logSpinIfChanged, spinEvents, type SpinChangedEvent, type SpinRawEvent, type SpinRawFailedEvent } from "../../lore/resolve.js";
import { fingerprintStream, fingerprintAvailable } from "../../lore/stream-fingerprint.js";
import {
  evaluateFingerprintPolicy,
  markFingerprintRun,
  tryReserveFingerprint,
  releaseFingerprintReservation,
  type FingerprintTrigger,
} from "../../lore/fingerprint-policy.js";
import { classifyFreshness } from "../../lore/freshness.js";
import { pollStation } from "../../lore/poller.js";
import { attachListener, isRelayAllowed } from "../../lore/stream-relay.js";
import { computeGenreBreakdown, computeDiscoveryScore, labelFromScore } from "../../lore/genre-insights.js";
import { acquire as sseAcquire, release as sseRelease } from "../../lore/sseConnectionTracker.js";
import { eligibleDjName } from "@workspace/lore-attribution";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Now-playing base query cache (30 seconds, user-independent)
//
// The GET /api/stations/now-playing handler runs three DB queries:
//   1. selectDistinctOn across the full spins table — the heaviest query.
//   2. Batch "seen before" check per resolved MBID.
//   3. Batch release-group lookup per MBID.
//
// These three queries are identical for all users. The per-user parts
// (library hit flags via buildLibraryHitContext) are applied on top of the
// cached rows. A 30-second TTL means the cache is always refreshed well
// within the ICY/Spinitron poller cadence, so the dial shows current tracks.
//
// Date-filtered requests (ghost-dial) are never cached — they are rare and
// date-specific so sharing would require a per-date key.
// ---------------------------------------------------------------------------

const NP_BASE_CACHE_TTL_MS = 30 * 1000; // 30 seconds

type NpBaseCache = {
  builtAt: number;
  stations: { id: number; slug: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  seenBefore: Set<string>;
  rgMap: Map<string, string>;
};

let npBaseCache: NpBaseCache | null = null;
// Parallel live cache for the inclusive (mode-pool) variant — the Scan lens
// polls with ?includeModePools=true and must not evict the dial's base cache.
let npBaseCacheInclusive: NpBaseCache | null = null;

// Date-filtered (ghost-dial) base results share the same 30s TTL, keyed by
// date. The default "today" sweep position hits this map instead of re-running
// the heavy selectDistinctOn scan on every request. Small and bounded — the
// sweep touches a handful of dates at a time.
const npDateCache = new Map<string, NpBaseCache>();
const NP_DATE_CACHE_MAX_ENTRIES = 16;

/** Invalidate the now-playing base cache — called by the SSE push path when a new spin lands. */
export function invalidateNowPlayingBaseCache(): void {
  npBaseCache = null;
  npBaseCacheInclusive = null;
  // A new spin only changes "today", but clearing the whole map is cheap and
  // avoids timezone hair-splitting about which date string "today" is.
  npDateCache.clear();
}

// ---------------------------------------------------------------------------
// Single-flight base fill.
//
// The cold fill (selectDistinctOn across the full spins table) takes several
// seconds right after a server restart. Two problems fall out of that:
//   1. Every concurrent cold request used to run its own copy of the heavy
//      scan — an in-flight map dedupes them onto one promise per cache key.
//   2. The first dial visitor used to stare at "Loading stations…" for the
//      full fill duration — the handler now waits only briefly for a cold
//      fill and otherwise returns a stations-only partial response while the
//      fill completes in the background (the client's normal 5s poll picks up
//      the full payload on its next tick). prewarmNowPlayingBaseCache() also
//      kicks the fill off at boot so most restarts never surface a partial.
// ---------------------------------------------------------------------------

const npFillInFlight = new Map<string, Promise<NpBaseCache>>();

// Stations-only snapshot published by the shared stations stage as soon as
// its (cheap) query returns — i.e. seconds before the heavy spins scan
// finishes. Used by the cold-start partial response so it doesn't have to run
// its own stations query against a DB pool saturated by boot work.
// Two variants: the default crossing-eligible list, and an inclusive variant
// that also covers the sleep / era-genre mode pools (the Scan lens tunes
// those stations too, so it needs their now-playing rows).
let npStationsSnapshot: { id: number; slug: string }[] | null = null;
let npStationsSnapshotInclusive: { id: number; slug: string }[] | null = null;

// Single-flight for the stations stage itself: the boot prewarm, concurrent
// cold fills, and the partial-response fallback all join ONE stations query
// instead of racing their own copies against a contended pool. On failure the
// promise clears so the next caller retries; the error propagates to whoever
// awaited it (a failed partial request returns 500 rather than a silent []).
let npStationsInFlight: Promise<{ id: number; slug: string }[]> | null = null;
let npStationsInFlightInclusive: Promise<{ id: number; slug: string }[]> | null = null;

function fetchNpStations(includeModePools = false): Promise<{ id: number; slug: string }[]> {
  const inFlight = includeModePools ? npStationsInFlightInclusive : npStationsInFlight;
  if (inFlight) return inFlight;
  // Inclusive = the default dial predicate UNION the mode pools (mirrors
  // GET /api/stations ?mode=sleep / ?mode=era-genre, whose stations are
  // intentionally hidden from the default list).
  const where = includeModePools
    ? and(
        eq(stationsTable.active, true),
        or(
          and(
            eq(stationsTable.hidden, false),
            eq(stationsTable.crossingEligible, true),
          ),
          eq(stationsTable.sleepMode, true),
          eq(stationsTable.eraGenreMode, true),
        ),
      )
    : and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        eq(stationsTable.crossingEligible, true),
      );
  const p = db
    .select({ id: stationsTable.id, slug: stationsTable.slug })
    .from(stationsTable)
    .where(where)
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name))
    .then((stations) => {
      if (includeModePools) npStationsSnapshotInclusive = stations;
      else npStationsSnapshot = stations;
      return stations;
    })
    .finally(() => {
      if (includeModePools) npStationsInFlightInclusive = null;
      else npStationsInFlight = null;
    });
  if (includeModePools) npStationsInFlightInclusive = p;
  else npStationsInFlight = p;
  return p;
}

// Counts buildNpBase executions — exposed for tests to assert single-flight.
let npBuildCount = 0;

/** Tests only: number of times the heavy base fill has actually run. */
export function _testOnly_getNpBuildCount(): number {
  return npBuildCount;
}

/** Tests only: drop every now-playing cache layer (base, per-date, stations snapshot). */
export function _testOnly_resetNpCaches(): void {
  npBaseCache = null;
  npBaseCacheInclusive = null;
  npDateCache.clear();
  npStationsSnapshot = null;
  npStationsSnapshotInclusive = null;
}

/** Tests only: mark the live base cache as expired (keeps its data for SWR checks). */
export function _testOnly_expireNpBaseCache(): void {
  if (npBaseCache) npBaseCache.builtAt = 0;
  if (npBaseCacheInclusive) npBaseCacheInclusive.builtAt = 0;
}

/** How long a cold live request waits for the base fill before serving a stations-only partial. */
const NP_COLD_FILL_WAIT_MS = 1500;
let npColdFillWaitMs = NP_COLD_FILL_WAIT_MS;

/** Override the cold-fill wait (ms) — tests only. Returns a restore fn so
 *  nested overrides compose (same pattern as _testOnly_setColdComputeDeadline). */
export function _testOnly_setNpColdFillWaitMs(ms: number): () => void {
  const prev = npColdFillWaitMs;
  npColdFillWaitMs = ms;
  return () => { npColdFillWaitMs = prev; };
}

async function buildNpBase(dateFilter: string | null, includeModePools = false): Promise<NpBaseCache> {
  npBuildCount++;
  const stations = await fetchNpStations(includeModePools);

  const rows = await db
    .selectDistinctOn([spinsTable.stationId], {
      spinId: spinsTable.id,
      stationId: spinsTable.stationId,
      stationName: stationsTable.name,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      source: spinsTable.source,
      confidence: spinsTable.confidence,
      playedAt: spinsTable.playedAt,
      // Rows predating the observed_at column fall back to created_at.
      observedAt: sql<Date>`coalesce(${spinsTable.observedAt}, ${spinsTable.createdAt})`.mapWith(spinsTable.createdAt),
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      releaseDate: recordingsTable.releaseDate,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(
      dateFilter
        ? and(isNotNull(spinsTable.stationId), sql`${spinsTable.playedAt}::date = ${dateFilter}::date`)
        : isNotNull(spinsTable.stationId),
    )
    .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

  // Batch-check which resolved MBIDs have been seen in the archive before today.
  // A track is "first in archive" only when it has never been logged on any prior day.
  const nowPlayingMbids = new Set<string>();
  for (const row of rows) { if (row.mbid) nowPlayingMbids.add(row.mbid); }

  // Batch-fetch the primary release-group MBID for each now-playing spin so we
  // can do album-level library widening without joining the RG table in the
  // selectDistinctOn query (which would complicate the DISTINCT ON semantics).
  const rgMap = new Map<string, string>(); // recording MBID → release-group MBID
  const [seenRows, rgRows] = await Promise.all([
    nowPlayingMbids.size > 0
      ? db.execute<{ mbid: string }>(sql`
          SELECT DISTINCT mbid FROM spins
          WHERE mbid = ANY(ARRAY[${sql.join([...nowPlayingMbids].map((m) => sql`${m}`), sql`, `)}]::text[])
            AND played_at::date < CURRENT_DATE
        `)
      : Promise.resolve({ rows: [] as { mbid: string }[] }),
    nowPlayingMbids.size > 0
      ? db
          .select({
            recordingMbid: recordingReleaseGroupsTable.recordingMbid,
            releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
          })
          .from(recordingReleaseGroupsTable)
          .where(
            and(
              inArray(recordingReleaseGroupsTable.recordingMbid, [...nowPlayingMbids]),
              eq(recordingReleaseGroupsTable.isPrimary, true),
            ),
          )
      : Promise.resolve([] as { recordingMbid: string; releaseGroupMbid: string }[]),
  ]);

  const seenBefore = new Set<string>();
  for (const r of seenRows.rows) seenBefore.add(r.mbid);
  for (const r of rgRows) rgMap.set(r.recordingMbid, r.releaseGroupMbid);

  const base: NpBaseCache = { builtAt: Date.now(), stations, rows, seenBefore, rgMap };
  if (!dateFilter) {
    if (includeModePools) npBaseCacheInclusive = base;
    else npBaseCache = base;
  } else {
    // Per-date cache with a small LRU-ish cap: evict expired entries first,
    // then the oldest, so the map stays bounded during long date sweeps.
    if (npDateCache.size >= NP_DATE_CACHE_MAX_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestBuiltAt = Infinity;
      for (const [key, entry] of npDateCache) {
        if (Date.now() - entry.builtAt >= NP_BASE_CACHE_TTL_MS) {
          npDateCache.delete(key);
          continue;
        }
        if (entry.builtAt < oldestBuiltAt) {
          oldestBuiltAt = entry.builtAt;
          oldestKey = key;
        }
      }
      if (npDateCache.size >= NP_DATE_CACHE_MAX_ENTRIES && oldestKey) {
        npDateCache.delete(oldestKey);
      }
    }
    npDateCache.set(dateFilter, base);
  }
  return base;
}

/** Start (or join) the base fill for a cache key. Single-flight per key. */
function fillNpBase(dateFilter: string | null, includeModePools = false): Promise<NpBaseCache> {
  const key = `${dateFilter ?? ""}${includeModePools ? "|all" : ""}`;
  const existing = npFillInFlight.get(key);
  if (existing) return existing;
  const promise = buildNpBase(dateFilter, includeModePools).finally(() => {
    npFillInFlight.delete(key);
  });
  npFillInFlight.set(key, promise);
  return promise;
}

/**
 * Prewarm the live (undated) now-playing base cache at boot so the first dial
 * visitor after a server restart never pays the cold fill. Best-effort:
 * failures log and the request path falls back to its normal cold-fill flow.
 */
export function prewarmNowPlayingBaseCache(): void {
  const startedAt = Date.now();
  fillNpBase(null)
    .then(() => {
      console.log(`[lore] now-playing base cache prewarmed in ${Date.now() - startedAt}ms`);
    })
    .catch((err) => {
      console.error("[lore] now-playing base cache prewarm failed", err);
    });
}

// Rate limit for client-reported now-playing: this is the only write path on
// an otherwise read-only public router, so it needs its own abuse guard.
// 20 req/min per IP comfortably covers one browser polling several Icecast
// fallback stations, while capping how much MusicBrainz/Spotify resolution
// work — and spins-table writes — a single caller can force.
const reportNowPlayingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

// Tighter limit for ACR fingerprint: each call runs ffmpeg (~8s) + an
// ACRCloud API call. 4 req/min per IP is plenty for a single listener and
// prevents runaway cost from repeated/scripted calls.
const fingerprintLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // The integration suite exercises the policy/cooldown layers with more
  // than 4 requests from one IP; the IP limiter itself is express-rate-limit
  // standard behavior and doesn't need re-testing here.
  skip: () => !!process.env["VITEST"],
});

// GET /api/stations
// Default (no mode): active=true, non-hidden, crossing-eligible stations only.
// ?mode=sleep: active=true, sleep_mode=true stations (hidden=true intentional).
// ?mode=era-genre: active=true, era_genre_mode=true stations (hidden=true intentional).
// Unknown mode values return 400.
// Longtail candidates (active=false) are health-gated and must not appear in
// the public directory. crossingEligible=false stations (e.g. FIP sub-channels)
// continue to ingest and accumulate history but are excluded from the crossing
// surface so they do not dilute the dial.
// `upcomingShowCount` is a denormalized column written by the schedule scraper
// in the same transaction as each scraped_shows replace, so no second query
// is needed here. LEFT JOINs station_quality to include qualityTier so the
// dial UI can badge or deprioritize low-quality stations.
router.get("/stations", h(async (req, res) => {
  const rawMode = typeof req.query.mode === "string" ? req.query.mode.trim() : undefined;
  if (rawMode !== undefined && rawMode !== "sleep" && rawMode !== "era-genre") {
    return res.status(400).json({ error: `Unknown mode: "${rawMode}". Supported values: sleep, era-genre` });
  }
  const isSleepMode = rawMode === "sleep";
  const isEraGenreMode = rawMode === "era-genre";

  const whereClause = isSleepMode
    ? and(
        eq(stationsTable.active, true),
        eq(stationsTable.sleepMode, true),
      )
    : isEraGenreMode
    ? and(
        eq(stationsTable.active, true),
        eq(stationsTable.eraGenreMode, true),
      )
    : and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        eq(stationsTable.crossingEligible, true),
      );

  const rows = await db
    .select({
      station: stationsTable,
      qualityTier: stationQualityTable.qualityTier,
    })
    .from(stationsTable)
    .leftJoin(
      stationQualityTable,
      eq(stationQualityTable.stationId, stationsTable.id),
    )
    .where(whereClause)
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  const now = new Date();
  const stations = await Promise.all(
    rows.map(async (r) => {
      const resolvedClass = await resolveAutomationClass(
        r.station.id,
        r.station.ianaTimezone,
        r.station.automationClass ?? null,
        now,
      );
      return toStation(r.station, r.qualityTier, resolvedClass);
    }),
  );
  return res.json(ListStationsResponse.parse({ stations }));
}));

// GET /api/stations/now-playing — latest spin per station (the dial pulse).
// Optional ?date=YYYY-MM-DD returns the last spin per station on that calendar
// day instead of the global latest — powers the ghost-dial date sweep.
// Optional ?includeModePools=true unions the sleep / era-genre mode pools
// (intentionally hidden from the default list) into the station set — the
// Scan lens tunes those stations too, so it needs their now-playing rows.
// Ignored for date-filtered (ghost-dial) requests.
router.get("/stations/now-playing", h(async (req, res) => {
  const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : null;
  const dateFilter = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const includeModePools =
    !dateFilter &&
    (req.query.includeModePools === "true" || req.query.includeModePools === "1");

  // Soft auth: enrich with library hit flags when the listener has a session;
  // unauthenticated requests receive isLibraryHit=false, isArtistHit=false.
  // buildLibraryHitContext is itself cached per-user (5-min TTL in library-hits.ts).
  const [user] = await Promise.all([
    getUserFromSession(req).catch(() => null),
  ]);
  const hitCtx = user
    ? await buildLibraryHitContext(user.id).catch(() => EMPTY_HIT_CONTEXT)
    : EMPTY_HIT_CONTEXT;

  // ── Base query cache (user-independent, 30-second TTL) ───────────────────
  // Live requests share npBaseCache (or npBaseCacheInclusive for the
  // mode-pool variant); date-filtered (ghost-dial) requests share a small
  // per-date map with the same TTL so the default "today" position doesn't
  // re-run the heavy base scan on every request.
  const liveCache = includeModePools ? npBaseCacheInclusive : npBaseCache;
  let base: NpBaseCache | null = null;
  if (!dateFilter && liveCache && Date.now() - liveCache.builtAt < NP_BASE_CACHE_TTL_MS) {
    base = liveCache;
  } else if (dateFilter) {
    const dated = npDateCache.get(dateFilter);
    if (dated && Date.now() - dated.builtAt < NP_BASE_CACHE_TTL_MS) {
      base = dated;
    }
  }

  if (base === null) {
    // Single-flight: join any in-flight fill for this key instead of running
    // a duplicate heavy scan. The fill promise writes the cache itself.
    const fill = fillNpBase(dateFilter, includeModePools);

    if (!dateFilter && liveCache) {
      // Stale-while-revalidate: an expired live cache is still current within
      // the last poll cycle or two — serve it immediately and let the
      // background fill refresh it for the next request.
      fill.catch(() => { /* background refresh failure; next cold request retries */ });
      base = liveCache;
    } else if (!dateFilter) {
      // True cold start (nothing cached at all, e.g. right after a server
      // restart before the boot prewarm finishes). Wait briefly for the fill;
      // past the deadline, serve a stations-only partial so the dial can
      // render its station list instead of sitting on "Loading stations…".
      // The client's normal poll picks up the full payload on its next tick.
      // The stations-only fallback list comes from the snapshot the shared
      // stations stage publishes before the heavy scan; when it hasn't landed
      // yet (request racing the very first fill), join the SAME single-flight
      // stations query the fill is running — never issue a duplicate one.
      const snapshot = includeModePools ? npStationsSnapshotInclusive : npStationsSnapshot;
      const stationsOnly = snapshot
        ? Promise.resolve(snapshot)
        : fetchNpStations(includeModePools);
      stationsOnly.catch(() => { /* re-thrown below if actually needed */ });
      const winner = await Promise.race([
        fill.then((b) => ({ kind: "base" as const, base: b })),
        new Promise<{ kind: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout" }), npColdFillWaitMs).unref?.(),
        ),
      ]);
      if (winner.kind === "base") {
        base = winner.base;
      } else {
        fill.catch(() => { /* logged by the request that awaits it */ });
        const stations = await stationsOnly;
        return res.json(ListStationsNowPlayingResponse.parse({
          items: stations.map((s) => ({ slug: s.slug, nowPlaying: null })),
        }));
      }
    } else {
      // Date-filtered (ghost-dial) requests are rare and date-specific; they
      // wait for the full fill as before.
      base = await fill;
    }
  }

  const { stations, rows, seenBefore, rgMap } = base;
  const byStation = new Map(rows.map((r) => [r.stationId, r]));
  const items = stations.map((s) => {
    const row = byStation.get(s.id);
    if (!row) return { slug: s.slug, nowPlaying: null };
    const isFirstSpin = row.mbid != null && !seenBefore.has(row.mbid);
    const hitFlags = user
      ? checkLibraryHit(hitCtx, {
          mbid: row.mbid,
          releaseGroupMbid: row.mbid ? (rgMap.get(row.mbid) ?? null) : null,
          artistMbid: row.artistMbid,
          artist: row.artist ?? row.rawArtist ?? "",
        })
      : { isLibraryHit: false as const, isArtistHit: false as const };
    return {
      slug: s.slug,
      nowPlaying: toNowPlaying({ ...row, isFirstSpin, ...hitFlags }),
    };
  });

  return res.json(ListStationsNowPlayingResponse.parse({ items }));
}));

// GET /api/stations/now-playing/stream — Server-Sent Events push of spin
// changes. Two frame types share the default message channel:
//   spin-raw     — provisional: fired the moment a genuinely-new track passes
//                  the junk/ad + dedup checks, BEFORE resolution/persistence.
//                  Carries `type: "spin-raw"` and `provisional: true` so
//                  clients can show the new artist+title immediately with a
//                  "resolving" cue. Library-hit flags don't exist yet (no
//                  MBID), so both are false.
//   spin-changed — resolved: fired the moment the resolver persists the spin
//                  (persistent ICY watchers make this near-instant for
//                  favorite stations). Payload carries the resolved MBID so
//                  clients need no follow-up request.
//   spin-raw-failed — terminal failure: the provisional track never persisted
//                  (resolver error or declined write), so no spin-changed is
//                  coming. Clients must revert to the last persisted spin.
// Per-station serialisation in the emitter guarantees a station's spin-raw
// always precedes its matching terminal frame (spin-changed or
// spin-raw-failed).
// Plain SSE, deliberately outside the OpenAPI/orval surface (EventSource, not
// fetch). Must be registered before any /stations/:slug route.
//
// Library hit flags (isLibraryHit / isArtistHit) are computed per-connection
// using a context built from the listener's library at connect time. Unauthenticated
// connections receive both flags as false.
router.get("/stations/now-playing/stream", h(async (req, res) => {
  // Per-IP connection cap — reject before any DB work so abusive callers pay
  // only a map lookup. The limit is configurable via SSE_MAX_CONNECTIONS_PER_IP
  // (default 10). Excess connections receive 429 with a Retry-After hint.
  // trust proxy is set in app.ts so req.ip reflects the real client address.
  const clientIp = req.ip ?? "unknown";
  if (!sseAcquire(clientIp)) {
    res.setHeader("Retry-After", "60");
    res.status(429).json({ error: "Too many SSE connections from this IP" });
    return;
  }

  // Register the release handler immediately after acquiring the slot so that
  // early disconnects during the async session/DB work below never leak a
  // permanently held slot. A `released` flag makes it idempotent in case the
  // close event fires more than once.
  let released = false;
  const releaseSlot = () => {
    if (!released) {
      released = true;
      sseRelease(clientIp);
    }
  };
  req.on("close", releaseSlot);

  // Build the per-listener hit context before opening the stream. Any error
  // here (session lookup, DB query) falls back to the empty context so the
  // stream still opens — hit flags just won't fire for that connection.
  const user = await getUserFromSession(req).catch(() => null);
  let hitCtx = user
    ? await buildLibraryHitContext(user.id).catch(() => EMPTY_HIT_CONTEXT)
    : EMPTY_HIT_CONTEXT;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Disable proxy buffering so events flush immediately through nginx-style
    // proxies (the Replit preview proxy included).
    "X-Accel-Buffering": "no",
  });
  // Initial comment establishes the stream in the browser right away.
  res.write(":connected\n\n");

  const onSpin = (ev: SpinChangedEvent) => {
    if (res.writableEnded) return;
    const { isLibraryHit, isArtistHit } = checkLibraryHit(hitCtx, {
      mbid: ev.mbid,
      releaseGroupMbid: ev.releaseGroupMbid,
      artistMbid: ev.artistMbid,
      artist: ev.rawArtist,
    });
    res.write(`data: ${JSON.stringify({ ...ev, isLibraryHit, isArtistHit })}\n\n`);
  };
  spinEvents.on("spin-changed", onSpin);

  // Provisional fast path: forward raw observations immediately so browsers
  // can show the new artist+title while resolution is still in flight. Hit
  // flags require a resolved MBID, so both are false on these frames.
  const onRaw = (ev: SpinRawEvent) => {
    if (res.writableEnded) return;
    res.write(
      `data: ${JSON.stringify({ ...ev, type: "spin-raw", isLibraryHit: false, isArtistHit: false })}\n\n`,
    );
  };
  spinEvents.on("spin-raw", onRaw);

  // Terminal failure: the provisional track never persisted (resolver error,
  // declined write) — clients must revert to the last persisted spin.
  const onRawFailed = (ev: SpinRawFailedEvent) => {
    if (res.writableEnded) return;
    res.write(
      `data: ${JSON.stringify({ ...ev, type: "spin-raw-failed", isLibraryHit: false, isArtistHit: false })}\n\n`,
    );
  };
  spinEvents.on("spin-raw-failed", onRawFailed);

  // Keep-alive comment every 30s so idle proxies don't kill the connection.
  const ping = setInterval(() => res.write(":ping\n\n"), 30_000);

  // Refresh the library hit context every 5 minutes so a Spotify import or
  // manual keep completed mid-session is reflected within one polling cycle.
  // Fire-and-forget: if the DB is temporarily unavailable the stale context
  // is kept and the stream continues uninterrupted.
  const hitCtxRefresh = user
    ? setInterval(() => {
        buildLibraryHitContext(user.id)
          .then((fresh) => { hitCtx = fresh; })
          .catch(() => { /* keep stale context on error */ });
      }, 5 * 60 * 1000)
    : null;

  req.on("close", () => {
    clearInterval(ping);
    if (hitCtxRefresh !== null) clearInterval(hitCtxRefresh);
    spinEvents.off("spin-changed", onSpin);
    spinEvents.off("spin-raw", onRaw);
    spinEvents.off("spin-raw-failed", onRawFailed);
    // Slot is released by the earlier releaseSlot listener; no duplicate call needed.
  });

  return;
}));

// GET /api/stations/at/:date/now-playing — path-param variant of the above.
// The OpenAPI client generates path-param hooks for typed date routing; this
// route simply proxies the date into the query-param handler's logic.
router.get("/stations/at/:date/now-playing", h(async (req, res) => {
  const dateFilter = typeof req.params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.params.date)
    ? req.params.date
    : null;
  if (!dateFilter) {
    return res.status(400).json({ error: "date path param must be YYYY-MM-DD" });
  }

  const stations = await db
    .select({ id: stationsTable.id, slug: stationsTable.slug })
    .from(stationsTable)
    .where(and(
      eq(stationsTable.active, true),
      eq(stationsTable.hidden, false),
      eq(stationsTable.crossingEligible, true),
    ))
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  const rows = await db
    .selectDistinctOn([spinsTable.stationId], {
      spinId: spinsTable.id,
      stationId: spinsTable.stationId,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      source: spinsTable.source,
      confidence: spinsTable.confidence,
      playedAt: spinsTable.playedAt,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      releaseDate: recordingsTable.releaseDate,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(
      and(isNotNull(spinsTable.stationId), sql`${spinsTable.playedAt}::date = ${dateFilter}::date`),
    )
    .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

  // Batch-check which resolved MBIDs have been seen before the requested date.
  const atDateMbids = new Set<string>();
  for (const row of rows) { if (row.mbid) atDateMbids.add(row.mbid); }
  const seenBeforeDate = new Set<string>();
  if (atDateMbids.size > 0) {
    const mbidArr = [...atDateMbids];
    const mbidSql = sql.join(mbidArr.map((m) => sql`${m}`), sql`, `);
    const seenRows = await db.execute<{ mbid: string }>(sql`
      SELECT DISTINCT mbid FROM spins
      WHERE mbid = ANY(ARRAY[${mbidSql}]::text[])
        AND played_at::date < ${dateFilter}::date
    `);
    for (const r of seenRows.rows) seenBeforeDate.add(r.mbid);
  }

  const byStation = new Map(rows.map((r) => [r.stationId, r]));
  const items = stations.map((s) => {
    const row = byStation.get(s.id);
    return {
      slug: s.slug,
      nowPlaying: row
        ? toNowPlaying({ ...row, isFirstSpin: row.mbid != null && !seenBeforeDate.has(row.mbid) })
        : null,
    };
  });

  return res.json(ListStationsNowPlayingResponse.parse({ items }));
}));

// GET /api/stations/:slug/now-playing
router.get("/stations/:slug/now-playing", h(async (req, res) => {
  const parsed = GetStationNowPlayingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsed.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [row] = await db
    .select({
      spinId: spinsTable.id,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      source: spinsTable.source,
      confidence: spinsTable.confidence,
      playedAt: spinsTable.playedAt,
      // Rows predating the observed_at column fall back to created_at.
      observedAt: sql<Date>`coalesce(${spinsTable.observedAt}, ${spinsTable.createdAt})`.mapWith(spinsTable.createdAt),
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      releaseDate: recordingsTable.releaseDate,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(eq(spinsTable.stationId, station.id))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  // Check whether this MBID has been seen in the archive before today.
  let isFirstSpin = false;
  if (row?.mbid) {
    const seenRows = await db.execute<{ found: number }>(sql`
      SELECT 1 AS found FROM spins
      WHERE mbid = ${row.mbid}
        AND played_at::date < CURRENT_DATE
      LIMIT 1
    `);
    isFirstSpin = seenRows.rows.length === 0;
  }

  const resolvedClass = await resolveAutomationClass(
    station.id,
    station.ianaTimezone,
    station.automationClass ?? null,
  );
  return res.json(
    GetStationNowPlayingResponse.parse({
      station: toStation(station, undefined, resolvedClass),
      nowPlaying: row ? toNowPlaying({ ...row, isFirstSpin }) : null,
    }),
  );
}));

// GET /api/stations/:slug/relay
// Server-side HTTPS relay for allowlisted HTTP-only Icecast/Shoutcast streams.
// Browsers running Lore over HTTPS block plain-HTTP audio as mixed content;
// this endpoint opens one upstream connection per station and fans the raw
// bytes (plus ICY metadata headers) out to every listener. See
// lore/stream-relay.ts for session management, listener caps, and back-off.
router.get("/stations/:slug/relay", h(async (req, res) => {
  const slug = req.params.slug;
  if (typeof slug !== "string" || !isRelayAllowed(slug)) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select({ streamUrl: stationsTable.streamUrl })
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const result = await attachListener(slug, station.streamUrl ?? "", res);
  switch (result.kind) {
    case "ok":
      // attachListener has taken ownership of `res`: headers are written when
      // the upstream connects, bytes stream until either side disconnects.
      return;
    case "not_allowed":
      return res.status(404).json({ error: "Station not found" });
    case "no_stream_url":
      return res.status(503).json({ error: "No relayable stream for this station" });
    case "cap_exceeded":
      return res.status(503).json({ error: "Relay listener limit reached" });
    case "upstream_unavailable":
      return res.status(503).json({ error: "Upstream stream unavailable" });
  }
}));

// POST /api/stations/:slug/report-now-playing
// Client-reported now-playing for stations with no server-side poller (e.g. a
// RadioBrowser/Icecast station the browser polls directly). Resolved through
// the same MusicBrainz/Spotify pipeline as any server-polled spin via
// logSpinIfChanged, so the result is indistinguishable from a normal spin.
router.post("/stations/:slug/report-now-playing", reportNowPlayingLimiter, h(async (req, res) => {
  const parsedParams = ReportStationNowPlayingParams.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const parsedBody = IcecastReportBody.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid report body", details: parsedBody.error.flatten() });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsedParams.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const rawArtist = parsedBody.data.rawArtist?.trim() ?? "";
  const rawTitle = parsedBody.data.rawTitle.trim();

  const logged = await logSpinIfChanged(station, { rawArtist, rawTitle });

  const [latest] = await db
    .select({ mbid: spinsTable.mbid, confidence: spinsTable.confidence })
    .from(spinsTable)
    .where(eq(spinsTable.stationId, station.id))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  return res.json(
    IcecastReportResultBody.parse({
      logged,
      mbid: latest?.mbid ?? null,
      ...(latest?.confidence && latest.confidence !== "spotify"
        ? { confidence: latest.confidence }
        : {}),
    }),
  );
}));

// ---------------------------------------------------------------------------
// POST /api/stations/:slug/fingerprint
//
// Targeted ACR fingerprint fallback. Every request runs through the shared
// trigger policy (lore/fingerprint-policy.ts): explicit "Identify this
// station" actions are always trigger-eligible; automatic requests (the
// ListeningLogger's fallback sends trigger:"auto") only proceed for stations
// with no metadata source, stale metadata, or the hand-curated ACR allowlist
// flag. A per-station cooldown bounds spend for both.
//
// Two-stage flow: before any audio is captured, a fresh metadata read runs
// for stations that HAVE a now-playing source — if that read comes back with
// a fresh spin, it is returned directly and no fingerprint fires. Only a
// still-empty/stale station reaches ffmpeg + ACRCloud. Matches are fed into
// logSpinIfChanged like any other spin, tagged source="acr_fingerprint" with
// playedAt derived from capture time minus the match's play offset.
//
// The stream URL comes from the DB (not the client) — no SSRF risk.
// Status codes: 503 ACR unconfigured; 404 unknown station; 422 no stream URL;
// 409 policy-ineligible (healthy metadata); 429 cooldown/rate limit;
// 502 capture/ACR hard failure. A clean "no match" is 200 {logged:false}.
// ---------------------------------------------------------------------------

// Seams for tests: swap the ffmpeg+ACR runner and the stage-1 metadata read
// without touching real streams or the poller.
let runFingerprint: typeof fingerprintStream = fingerprintStream;
let fingerprintReady: typeof fingerprintAvailable = fingerprintAvailable;
let stage1MetadataRefresh: (station: typeof stationsTable.$inferSelect) => Promise<void> =
  async (station) => pollStation(station);

/** Tests only: swap the fingerprint runner (also bypasses the availability check). */
export function _testOnly_setFingerprintRunner(fn: typeof fingerprintStream): () => void {
  const prevRun = runFingerprint;
  const prevReady = fingerprintReady;
  runFingerprint = fn;
  fingerprintReady = () => true;
  return () => { runFingerprint = prevRun; fingerprintReady = prevReady; };
}

/** Tests only: swap the stage-1 fresh metadata read. */
export function _testOnly_setStage1Refresh(
  fn: (station: typeof stationsTable.$inferSelect) => Promise<void>,
): () => void {
  const prev = stage1MetadataRefresh;
  stage1MetadataRefresh = fn;
  return () => { stage1MetadataRefresh = prev; };
}

/** Newest spin's freshness inputs + identity for a station, or null. */
async function latestSpinForStation(stationId: number): Promise<{
  mbid: string | null;
  confidence: string;
  source: string | null;
  observedAt: Date;
} | null> {
  const [row] = await db
    .select({
      mbid: spinsTable.mbid,
      confidence: spinsTable.confidence,
      source: spinsTable.source,
      observedAt: sql<Date>`coalesce(${spinsTable.observedAt}, ${spinsTable.createdAt})`.mapWith(spinsTable.createdAt),
    })
    .from(spinsTable)
    .where(eq(spinsTable.stationId, stationId))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);
  return row ?? null;
}

router.post("/stations/:slug/fingerprint", fingerprintLimiter, h(async (req, res) => {
  if (!fingerprintReady()) {
    return res.status(503).json({ error: "ACR fingerprint is not configured" });
  }

  const parsedParams = ReportStationNowPlayingParams.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  // Trigger provenance: automatic callers (ListeningLogger) send
  // { trigger: "auto" }; anything else — including the bodyless legacy call —
  // is treated as an explicit listener action.
  const trigger: FingerprintTrigger =
    (req.body as { trigger?: string } | undefined)?.trigger === "auto" ? "auto" : "explicit";

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsedParams.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const latestBefore = await latestSpinForStation(station.id);
  const decision = evaluateFingerprintPolicy(
    station,
    latestBefore ? { source: latestBefore.source, observedAt: latestBefore.observedAt } : null,
    trigger,
  );
  if (!decision.eligible) {
    if (decision.reason === "no_stream_url") {
      return res.status(422).json({ error: "Station has no stream URL" });
    }
    if (decision.reason === "cooldown") {
      res.setHeader("Retry-After", String(Math.ceil((decision.retryAfterMs ?? 0) / 1000)));
      return res.status(429).json({ error: "Fingerprint cooldown active for this station" });
    }
    // healthy_metadata — automatic fallback must not spend ACR budget here.
    return res.status(409).json({ error: "Station metadata is healthy; fingerprint not needed" });
  }

  // Atomic admission: hold a per-station reservation across the async stages
  // so two concurrent requests can't both pass the cooldown check and both
  // bill an ACR capture. A concurrent holder reads as a cooldown to callers.
  if (!tryReserveFingerprint(station.id)) {
    res.setHeader("Retry-After", "10");
    return res.status(429).json({ error: "A fingerprint for this station is already in progress" });
  }
  try {

  // ── Stage 1: fresh metadata read ─────────────────────────────────────────
  // Cheaper and more precise than audio capture when the source responds.
  // Only stations WITH a configured source can be re-read; a fresh result
  // short-circuits the fingerprint entirely.
  if (station.nowPlayingSource) {
    try {
      await stage1MetadataRefresh(station);
    } catch (err) {
      console.error("[lore] fingerprint stage-1 metadata read failed", station.slug, err);
    }
    const latest = await latestSpinForStation(station.id);
    if (latest && classifyFreshness(latest.source, latest.observedAt) === "fresh") {
      return res.json(
        IcecastReportResultBody.parse({
          logged: false,
          mbid: latest.mbid,
          ...(latest.confidence ? { confidence: latest.confidence } : {}),
        }),
      );
    }
  }

  // ── Stage 2: capture + ACR fingerprint ───────────────────────────────────
  // Arm the cooldown when the capture actually starts (a failed capture still
  // spent ffmpeg time and possibly an ACR call).
  markFingerprintRun(station.id);

  let result: Awaited<ReturnType<typeof fingerprintStream>>;
  try {
    result = await runFingerprint(station.streamUrl);
  } catch (err) {
    console.error("[lore] fingerprint failed", station.slug, err);
    return res.status(502).json({ error: "Fingerprint failed", detail: String(err) });
  }

  const { match, clipEndedAt } = result;
  if (!match) {
    // Honest "couldn't identify" — never presented as "nothing playing".
    return res.json(IcecastReportResultBody.parse({ logged: false, mbid: null }));
  }

  const logged = await logSpinIfChanged(
    station,
    {
      rawArtist: match.artist,
      rawTitle: match.title,
      ...(match.isrc ? { isrc: match.isrc } : {}),
      // Preserve the provider's position signal. play_offset_ms is the
      // position in the matched ORIGINAL track at the END of the recognized
      // clip, so it's paired with the clip-end timestamp — not the capture
      // start (which would overstate elapsed time by the clip duration).
      playOffsetMs: match.playOffsetMs,
      offsetCapturedAt: clipEndedAt,
      // Play offset places the spin where the song actually started.
      playedAt: new Date(clipEndedAt.getTime() - match.playOffsetMs),
    },
    { source: "acr_fingerprint" },
  );

  const [latest] = await db
    .select({ mbid: spinsTable.mbid, confidence: spinsTable.confidence })
    .from(spinsTable)
    .where(eq(spinsTable.stationId, station.id))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  return res.json(
    IcecastReportResultBody.parse({
      logged,
      mbid: latest?.mbid ?? null,
      ...(latest?.confidence ? { confidence: latest.confidence } : {}),
    }),
  );

  } finally {
    releaseFingerprintReservation(station.id);
  }
}));

// GET /api/stations/:slug/archive — a station's documented runs, newest first.
router.get("/stations/:slug/archive", h(async (req, res) => {
  const parsed = GetStationArchiveParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsed.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const requestedOffset = typeof req.query.offset === "string"
    ? Number.parseInt(req.query.offset, 10)
    : null;
  const requestedLimit = typeof req.query.limit === "string"
    ? Number.parseInt(req.query.limit, 10)
    : null;
  const paged = requestedOffset != null || requestedLimit != null;
  const offset = Number.isFinite(requestedOffset) && requestedOffset! >= 0 ? requestedOffset! : 0;
  const pageSize = Number.isFinite(requestedLimit)
    ? Math.min(50, Math.max(1, requestedLimit!))
    : 25;
  const queryLimit = paged ? pageSize + 1 : 120;
  const runRows = await db
    .select({
      runId: spinRunIdExpr,
      date: spinDayExpr,
      showId: spinsTable.showId,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      citation: sql<string | null>`max(${spinsTable.citation})`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
      showName: showsTable.name,
      djName: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(eq(spinsTable.stationId, station.id))
    .groupBy(spinDayExpr, spinsTable.showId, showsTable.name, showsTable.djName)
    .orderBy(sql`max(${spinsTable.playedAt}) desc`)
    .limit(queryLimit)
    .offset(paged ? offset : 0);
  const hasMore = paged && runRows.length > pageSize;
  const runs = hasMore ? runRows.slice(0, pageSize) : runRows;

  const resolvedClass = await resolveAutomationClass(
    station.id,
    station.ianaTimezone,
    station.automationClass ?? null,
  );
  return res.json(
    GetStationArchiveResponse.parse({
      station: toStation(station, undefined, resolvedClass),
      runs: runs.map((r) => ({
        runId: r.runId,
        date: r.date,
        show: r.showName
          ? {
              name: r.showName,
              djName: eligibleDjName(r.djName, {
                showTitle: r.showName,
                stationName: station.name,
              }),
            }
          : null,
        spinCount: r.spinCount,
        resolvedCount: r.resolvedCount,
        sourceUrl:
          stationArchiveUrl(station.nowPlayingSource, r.date, station.nowPlayingConfig as Record<string, unknown> | null) ??
          r.citation ??
          null,
        startedAt: new Date(r.startedAt).toISOString(),
        endedAt: new Date(r.endedAt).toISOString(),
      })),
      ...(paged ? { nextOffset: hasMore ? offset + pageSize : null } : {}),
    }),
  );
}));

// GET /api/stations/:slug/insights — genre breakdown + discovery score for a
// station. Persisted-first: the insights job periodically caches a cumulative
// `genreProfile` and `discoveryScore` onto the stations row, so this endpoint
// serves those columns directly when they exist. Only a station the job has
// never scored (both columns null) falls back to a live aggregation over its
// spin history — same math, just computed on read.
router.get("/stations/:slug/insights", h(async (req, res) => {
  const parsed = GetStationInsightsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsed.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const stationRef = {
    slug: station.slug,
    name: station.name,
    stationClass: station.stationClass,
  };

  if (station.genreProfile != null || station.discoveryScore != null) {
    // Served from the persisted columns. The cached discovery score is just
    // the 0-100 number — medianAgeYears/sampleSize/unknownCount aren't
    // persisted, so they degrade to null/0 rather than being recomputed
    // (the UI treats them as optional detail).
    return res.json(
      GetStationInsightsResponse.parse({
        station: stationRef,
        insights: {
          genreBreakdown:
            station.genreProfile ?? { top: [], unknownCount: 0, totalCount: 0 },
          discoveryScore:
            station.discoveryScore != null
              ? {
                  medianAgeYears: null,
                  score: station.discoveryScore,
                  label: labelFromScore(station.discoveryScore),
                  sampleSize: 0,
                  unknownCount: 0,
                }
              : {
                  medianAgeYears: null,
                  score: null,
                  label: "unknown",
                  sampleSize: 0,
                  unknownCount: 0,
                },
        },
      }),
    );
  }

  const rows = await db
    .select({
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      playedAt: spinsTable.playedAt,
    })
    .from(spinsTable)
    .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(eq(spinsTable.stationId, station.id));

  return res.json(
    GetStationInsightsResponse.parse({
      station: stationRef,
      insights: {
        genreBreakdown: computeGenreBreakdown(rows),
        discoveryScore: computeDiscoveryScore(
          rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
        ),
      },
    }),
  );
}));

// GET /api/stations/:slug/spins — full logged spin history, paginated by
// time, newest first. Independent of show/run grouping — this is what powers
// the universal scrub timeline (curated stations AND longtail radio-browser
// stations alike, since it needs no documented "run").
router.get("/stations/spins", h(async (req, res) => {
  const parsedQuery = GetStationSpinsQueryParams.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsedQuery.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const before = parsedQuery.data.before ? new Date(parsedQuery.data.before) : null;
  const limit = Math.min(Math.max(parsedQuery.data.limit ?? 50, 1), 200);

  const [bounds] = await db
    .select({
      oldestSpinAt: sql<string | null>`min(${spinsTable.playedAt})`,
      newestSpinAt: sql<string | null>`max(${spinsTable.playedAt})`,
      spinCount: sql<number>`count(*)::int`,
    })
    .from(spinsTable)
    .where(eq(spinsTable.stationId, station.id));

  const rows = await db
    .select({
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      confidence: spinsTable.confidence,
      mbid: recordingsTable.mbid,
      recTitle: recordingsTable.title,
      recArtist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(
      before && !Number.isNaN(before.getTime())
        ? and(eq(spinsTable.stationId, station.id), sql`${spinsTable.playedAt} < ${before}`)
        : eq(spinsTable.stationId, station.id),
    )
    .orderBy(desc(spinsTable.playedAt))
    .limit(limit);

  return res.json(
    GetStationSpinsResponse.parse({
      station: {
        slug: station.slug,
        name: station.name,
        stationClass: station.stationClass,
      },
      tracks: rows.map((r, i) => ({
        position: i,
        playedAt: r.playedAt.toISOString(),
        rawArtist: r.rawArtist ?? "",
        rawTitle: r.rawTitle ?? "",
        confidence: r.confidence,
        recording: toArchiveRecording(r),
      })),
      nextBefore:
        rows.length === limit ? rows[rows.length - 1]!.playedAt.toISOString() : null,
      bounds: {
        oldestSpinAt: bounds?.oldestSpinAt ? new Date(bounds.oldestSpinAt).toISOString() : null,
        newestSpinAt: bounds?.newestSpinAt ? new Date(bounds.newestSpinAt).toISOString() : null,
        spinCount: bounds?.spinCount ?? 0,
      },
    }),
  );
}));

// GET /api/stations/:slug/overlaps/pickers — "Critics agree": curated (non-DJ)
// pickers whose lists contain recordings this station has actually spun.
// Exact MBID overlap only — never similarity.
router.get("/stations/:slug/overlaps/pickers", h(async (req, res) => {
  const parsed = GetStationPickerOverlapsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, parsed.data.slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const stationMbids = db
    .select({ mbid: spinsTable.mbid })
    .from(spinsTable)
    .where(and(eq(spinsTable.stationId, station.id), isNotNull(spinsTable.mbid)));

  const sharedExpr = sql<number>`count(distinct ${picksTable.mbid})::int`;
  const rows = await db
    .select({
      name: pickersTable.name,
      handle: pickersTable.handle,
      pickerType: pickersTable.pickerType,
      trustTier: pickersTable.trustTier,
      sharedCount: sharedExpr,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        ne(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, stationMbids),
        pickerNotOptedOut(pickersTable.id),
      ),
    )
    .groupBy(
      pickersTable.id,
      pickersTable.name,
      pickersTable.handle,
      pickersTable.pickerType,
      pickersTable.trustTier,
    )
    .orderBy(
      sql`count(distinct ${picksTable.mbid}) desc`,
      asc(pickersTable.trustTier),
      asc(pickersTable.name),
    )
    .limit(12);

  return res.json(
    GetStationPickerOverlapsResponse.parse({
      station: {
        slug: station.slug,
        name: station.name,
        stationClass: station.stationClass,
      },
      items: rows.map((r) => ({
        picker: {
          name: r.name,
          handle: r.handle,
          pickerType: r.pickerType,
          trustTier: r.trustTier,
        },
        sharedCount: r.sharedCount,
      })),
    }),
  );
}));

// GET /api/stations/recent-spins?date=YYYY-MM-DD  (calendar-day window)
// GET /api/stations/recent-spins?hours=48         (rolling window ending now)
// Recent spins per station ordered newest first.
// Uses a window function so all stations are fetched in one query.
// Date mode powers the track-chip timeline on showless station cards
// (e.g. Radio Paradise); hours mode powers the station new-music scan.
router.get("/stations/recent-spins", h(async (req, res) => {
  const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : null;
  const dateFilter = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  // Optional rolling-hours window (1-168). When valid, it replaces the
  // calendar-day filter with `played_at >= NOW() - interval`.
  const rawHours = typeof req.query.hours === "string" ? Number(req.query.hours) : null;
  const hoursFilter =
    rawHours != null && Number.isInteger(rawHours) && rawHours >= 1 && rawHours <= 168
      ? rawHours
      : null;
  if (rawHours != null && hoursFilter == null) {
    return res.status(400).json({ error: "hours must be an integer between 1 and 168" });
  }
  if (!dateFilter && !hoursFilter) {
    return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  }

  // Soft auth: annotate spins with library hit flags for authenticated listeners.
  const user = await getUserFromSession(req).catch(() => null);
  const hitCtx = user
    ? await buildLibraryHitContext(user.id).catch(() => EMPTY_HIT_CONTEXT)
    : EMPTY_HIT_CONTEXT;

  // Window predicate: rolling hours takes precedence over the calendar day.
  const windowPredicate = hoursFilter
    ? sql`sp.played_at >= NOW() - make_interval(hours => ${hoursFilter})`
    : sql`sp.played_at::date = ${dateFilter}::date`;

  const rows = await db.execute<{
    station_slug: string;
    mbid: string | null;
    artist_mbid: string | null;
    release_group_mbid: string | null;
    title: string | null;
    artist: string | null;
    raw_title: string | null;
    raw_artist: string | null;
    release_year: number | null;
    release_date: string | null;
    played_at: string;
    show_name: string | null;
    dj_name: string | null;
  }>(sql`
    WITH ranked AS (
      SELECT
        s.slug AS station_slug,
        s.name AS station_name,
        sp.mbid,
        r.artist_mbid,
        (
          SELECT rrg.release_group_mbid
          FROM recording_release_groups rrg
          WHERE rrg.recording_mbid = sp.mbid AND rrg.is_primary = true
          LIMIT 1
        ) AS release_group_mbid,
        r.title,
        r.artist,
        sp.raw_title,
        sp.raw_artist,
        r.release_year,
        r.release_date,
        sp.played_at,
        sh.name AS show_name,
        sh.dj_name,
        ROW_NUMBER() OVER (PARTITION BY sp.station_id ORDER BY sp.played_at DESC) AS rn
      FROM spins sp
      JOIN stations s ON s.id = sp.station_id AND s.hidden = false
      LEFT JOIN recordings r ON r.mbid = sp.mbid
      LEFT JOIN shows sh ON sh.id = sp.show_id
        AND ${validScheduleShowAttribution(sql`sp.station_id`, sql`sp.played_at`, sql`sh.name`, sql`sh.picker_id`)}
      WHERE ${windowPredicate}
        AND sp.station_id IS NOT NULL
    )
    SELECT station_slug, station_name, mbid, artist_mbid, release_group_mbid, title, artist, raw_title, raw_artist, release_year, release_date, played_at, show_name, dj_name
    FROM ranked
    -- Over-fetch beyond the 8 we actually want to render: some stations log
    -- the same track more than once in a row (metadata re-announces, ad-break
    -- interruptions that resume the same song, etc), so we need extra rows
    -- to still land on 8 *distinct* tracks after de-duping below.
    -- 80 rows per station: enough to cover a 3-hour show at ~1 spin/2min.
    -- The chip strip is capped client-side (show.spins.slice(0,28)) so UI
    -- is unaffected; the extra rows only widen crossing detection.
    WHERE rn <= 80
    ORDER BY station_slug, played_at DESC
  `);

  // No per-station cap: return all fetched spins so the client can compute
  // library crossings against the FULL show history, not just the latest 8.
  // The chip strip limits display client-side via slice(0, 28).
  const CHIPS_PER_STATION = 80;
  const bySlug = new Map<string, { mbid: string | null; artistMbid: string | null; releaseGroupMbid: string | null; title: string; artist: string; releaseYear: number | null; releaseDate: string | null; playedAt: string; playedAtHour: number; djName: string | null; showName: string | null }[]>();
  const seenBySlug = new Map<string, Set<string>>();
  for (const row of rows.rows) {
    const title = row.title ?? row.raw_title ?? "";
    const artist = row.artist ?? row.raw_artist ?? "";
    // Identify a "track" by MBID when resolved, otherwise by title+artist —
    // either way, the same song shouldn't show up twice in the chip strip.
    const dedupeKey = row.mbid ? `mbid:${row.mbid}` : `text:${title.toLowerCase()}|${artist.toLowerCase()}`;

    let seen = seenBySlug.get(row.station_slug);
    if (!seen) {
      seen = new Set();
      seenBySlug.set(row.station_slug, seen);
    }
    if (seen.has(dedupeKey)) continue;

    const arr = bySlug.get(row.station_slug) ?? [];
    if (arr.length >= CHIPS_PER_STATION) continue;
    seen.add(dedupeKey);

    const playedAtDate = new Date(row.played_at);
    const spin = {
      mbid: row.mbid ?? null,
      artistMbid: row.artist_mbid ?? null,
      releaseGroupMbid: row.release_group_mbid ?? null,
      title,
      artist,
      releaseYear: row.release_year ?? null,
      releaseDate: row.release_date ?? null,
      playedAt: playedAtDate.toISOString(),
      // UTC hour of day — discovery metadata for the new-music scan
      // ("this station airs new jazz 2-4 PM").
      playedAtHour: playedAtDate.getUTCHours(),
      // Attribution gate: generic/colliding DJ values are filtered the same
      // way every other surface does it (one pure normalized rule).
      djName: eligibleDjName(row.dj_name, {
        showTitle: row.show_name ?? undefined,
        title,
        artist,
      }),
      showName: row.show_name ?? null,
    };
    if (bySlug.has(row.station_slug)) arr.push(spin);
    else bySlug.set(row.station_slug, [spin]);
  }

  // Batch-check which resolved mbids have been seen in the archive before the
  // window start. A single ANY() query is cheaper than N correlated sub-selects.
  // Date mode: "before today"; hours mode: "before the rolling window opened".
  const allMbids = new Set<string>();
  for (const spins of bySlug.values()) {
    for (const sp of spins) { if (sp.mbid) allMbids.add(sp.mbid); }
  }
  const seenBeforeToday = new Set<string>();
  if (allMbids.size > 0) {
    const mbidArr = [...allMbids];
    const mbidSql = sql.join(mbidArr.map((m) => sql`${m}`), sql`, `);
    const beforeWindowPredicate = hoursFilter
      ? sql`played_at < NOW() - make_interval(hours => ${hoursFilter})`
      : sql`played_at::date < ${dateFilter}::date`;
    const seenRows = await db.execute<{ mbid: string }>(sql`
      SELECT DISTINCT mbid FROM spins
      WHERE mbid = ANY(ARRAY[${mbidSql}]::text[])
        AND ${beforeWindowPredicate}
    `);
    for (const row of seenRows.rows) seenBeforeToday.add(row.mbid);
  }

  const items = [...bySlug.entries()].map(([stationSlug, spins]) => ({
    stationSlug,
    spins: spins.map((sp) => {
      const isFirstSpin = sp.mbid != null && !seenBeforeToday.has(sp.mbid);
      const hitFlags = user
        ? checkLibraryHit(hitCtx, {
            mbid: sp.mbid,
            releaseGroupMbid: sp.releaseGroupMbid,
            artistMbid: sp.artistMbid,
            artist: sp.artist,
          })
        : { isLibraryHit: false as const, isArtistHit: false as const };
      return { ...sp, isFirstSpin, ...hitFlags };
    }),
  }));

  return res.json(GetStationsRecentSpinsResponse.parse({ items }));
}));

// GET /api/stations/schedule?date=YYYY-MM-DD
// Returns all show blocks (runs) for every station on a given UTC calendar day,
// ordered chronologically. One call powers the show timeline on every station card.
router.get("/stations/schedule", h(async (req, res) => {
  const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : null;
  const dateFilter = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (!dateFilter) {
    return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  }

  const rows = await db
    .select({
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      ianaTimezone: stationsTable.ianaTimezone,
      runId: spinRunIdExpr,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
      showName: showsTable.name,
      djName: showsTable.djName,
      djNames: showsTable.djNames,
      pickerId: showsTable.pickerId,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(
      and(
        isNotNull(spinsTable.stationId),
        eq(stationsTable.hidden, false),
        sql`${spinsTable.playedAt}::date = ${dateFilter}::date`,
      ),
    )
    .groupBy(
      stationsTable.slug,
      stationsTable.name,
      stationsTable.ianaTimezone,
      spinDayExpr,
      spinsTable.showId,
      showsTable.name,
      showsTable.djName,
      showsTable.djNames,
      showsTable.pickerId,
    )
    .orderBy(stationsTable.slug, sql`min(${spinsTable.playedAt})`);

  // Group into per-station arrays, preserving chronological order within each.
  const bySlug = new Map<string, (typeof rows)[number][]>();
  for (const row of rows) {
    const arr = bySlug.get(row.stationSlug);
    if (arr) arr.push(row);
    else bySlug.set(row.stationSlug, [row]);
  }

  const items = [...bySlug.entries()].map(([stationSlug, stationRuns]) => ({
    stationSlug,
    runs: stationRuns.map((r) => ({
      runId: r.runId,
      show: r.showName
        ? {
            name: r.showName,
            djName: eligibleDjName(r.djName, {
              showTitle: r.showName,
              stationName: r.stationName,
            }),
            // Multi-DJ: pass through the array when the show has multiple credited
            // selectors. The attribution cascade in Dial uses this to suppress
            // individual DJ names and fall back to the show-level sentence.
            djNames: r.djNames && r.djNames.length > 0 ? r.djNames : undefined,
            pickerId: r.pickerId ?? null,
          }
        : null,
      spinCount: r.spinCount,
      resolvedCount: r.resolvedCount,
      startedAt: new Date(r.startedAt).toISOString(),
      endedAt: new Date(r.endedAt).toISOString(),
      ianaTimezone: r.ianaTimezone ?? null,
    })),
  }));

  return res.json(GetStationsScheduleResponse.parse({ items }));
}));

// GET /api/stations/rolling-genres
// Returns the last ≤3 distinct-MBID spins with genre data per station, newest
// first. Discovery tier is derived inline from recordings.release_year:
//   ≤3yr → "new-music" | ≤10yr → "recent" | older → "catalog" | null → null
//
// Cached in memory with a 2-minute TTL — stale data is harmless because the
// genres and release years of recently-played tracks don't change.
const ROLLING_GENRES_TTL_MS = 2 * 60 * 1000;
type RollingChip = { genre: string; discoveryLabel: string | null; playedAt: string };
let _rollingGenresCache: { builtAt: number; data: Record<string, RollingChip[]> } | null = null;

function rollingDiscoveryLabel(releaseYear: number | null): string | null {
  if (releaseYear == null) return null;
  const age = new Date().getFullYear() - releaseYear;
  if (age <= 3) return "new-music";
  if (age <= 10) return "recent";
  return "catalog";
}

router.get("/stations/rolling-genres", h(async (_req, res) => {
  const now = Date.now();
  if (_rollingGenresCache && now - _rollingGenresCache.builtAt < ROLLING_GENRES_TTL_MS) {
    return res.json(
      GetStationsRollingGenresResponse.parse({ stations: _rollingGenresCache.data }),
    );
  }

  // DISTINCT ON (station_id, mbid) keeps only the most-recent play for each
  // unique track per station. The outer ROW_NUMBER then picks the newest 3
  // distinct tracks per station that actually have genre data.
  const rows = await db.execute<{
    station_slug: string;
    genre: string;
    release_year: number | null;
    played_at: string;
  }>(sql`
    WITH deduped AS (
      SELECT DISTINCT ON (sp.station_id, sp.mbid)
        s.slug          AS station_slug,
        r.genres[1]     AS genre,
        r.release_year,
        sp.played_at
      FROM spins sp
      JOIN stations s ON s.id = sp.station_id AND s.active = true AND s.hidden = false
      JOIN recordings r ON r.mbid = sp.mbid
      WHERE r.genres IS NOT NULL
        AND array_length(r.genres, 1) > 0
      ORDER BY sp.station_id, sp.mbid, sp.played_at DESC
    ),
    ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY station_slug ORDER BY played_at DESC) AS rn
      FROM deduped
    )
    SELECT station_slug, genre, release_year, played_at
    FROM ranked
    WHERE rn <= 3
    ORDER BY station_slug, played_at DESC
  `);

  const stations: Record<string, RollingChip[]> = {};
  for (const row of rows.rows) {
    if (!stations[row.station_slug]) stations[row.station_slug] = [];
    stations[row.station_slug]!.push({
      genre: row.genre,
      discoveryLabel: rollingDiscoveryLabel(row.release_year ?? null),
      playedAt: new Date(row.played_at).toISOString(),
    });
  }

  _rollingGenresCache = { builtAt: now, data: stations };
  return res.json(GetStationsRollingGenresResponse.parse({ stations }));
}));

// GET /api/stations/artist-frequency
// Lore-wide onboarding pool: only resolved plays on stations that are visible
// in the public directory. Canonical artist MBIDs collapse aliases from
// different recordings; the normalized fallback keeps older recordings without
// an artist MBID deterministic as well.
const ONBOARDING_ARTIST_LIMIT = 60;

router.get("/stations/artist-frequency", h(async (_req, res) => {
  const rows = await db.execute<{
    artist: string;
    artist_mbid: string | null;
    play_count: number;
  }>(sql`
    WITH resolved_artists AS (
      SELECT
        COALESCE(
          'mbid:' || r.artist_mbid,
          'name:' || lower(regexp_replace(r.artist, '[^[:alnum:]]', '', 'g'))
        ) AS artist_key,
        r.artist,
        r.artist_mbid
      FROM spins sp
      INNER JOIN stations s
        ON s.id = sp.station_id
       AND s.active = true
       AND s.hidden = false
      INNER JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.mbid IS NOT NULL
        AND r.artist IS NOT NULL
        AND length(trim(r.artist)) > 0
    )
    SELECT
      min(artist)::text AS artist,
      max(artist_mbid)::text AS artist_mbid,
      count(*)::int AS play_count
    FROM resolved_artists
    GROUP BY artist_key
    ORDER BY play_count DESC, lower(min(artist)), min(artist)
    LIMIT ${ONBOARDING_ARTIST_LIMIT}
  `);

  return res.json(GetStationsArtistFrequencyResponse.parse({
    artists: rows.rows.map((row) => ({
      artist: row.artist,
      artistMbid: row.artist_mbid,
      playCount: Number(row.play_count),
    })),
  }));
}));

// GET /api/stations/popular-artists
// 7-day "Popular on Lore" onboarding row: same grouping rules as
// artist-frequency but bounded to recent airplay so new listeners see names
// actually in rotation. Public + user-independent, so a short in-memory cache
// keeps the grouped scan off the request hot path.
const POPULAR_ARTIST_LIMIT = 12;
const POPULAR_ARTISTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let _popularArtistsCache: {
  builtAt: number;
  artists: { artist: string; artistMbid: string | null; playCount: number }[];
} | null = null;

router.get("/stations/popular-artists", h(async (_req, res) => {
  if (_popularArtistsCache && Date.now() - _popularArtistsCache.builtAt < POPULAR_ARTISTS_CACHE_TTL_MS) {
    return res.json(GetStationsPopularArtistsResponse.parse({ artists: _popularArtistsCache.artists }));
  }

  const rows = await db.execute<{
    artist: string;
    artist_mbid: string | null;
    play_count: number;
  }>(sql`
    WITH resolved_artists AS (
      SELECT
        COALESCE(
          'mbid:' || r.artist_mbid,
          'name:' || lower(regexp_replace(r.artist, '[^[:alnum:]]', '', 'g'))
        ) AS artist_key,
        r.artist,
        r.artist_mbid
      FROM spins sp
      INNER JOIN stations s
        ON s.id = sp.station_id
       AND s.active = true
       AND s.hidden = false
      INNER JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.mbid IS NOT NULL
        AND sp.played_at >= NOW() - INTERVAL '7 days'
        AND r.artist IS NOT NULL
        AND length(trim(r.artist)) > 0
    )
    SELECT
      min(artist)::text AS artist,
      max(artist_mbid)::text AS artist_mbid,
      count(*)::int AS play_count
    FROM resolved_artists
    GROUP BY artist_key
    ORDER BY play_count DESC, lower(min(artist)), min(artist)
    LIMIT ${POPULAR_ARTIST_LIMIT}
  `);

  const artists = rows.rows.map((row) => ({
    artist: row.artist,
    artistMbid: row.artist_mbid,
    playCount: Number(row.play_count),
  }));
  _popularArtistsCache = { builtAt: Date.now(), artists };
  return res.json(GetStationsPopularArtistsResponse.parse({ artists }));
}));

// GET /api/stations/recent-artists
// "Playing recently" onboarding row: artists with resolved spins in a rolling
// 4-hour window, ranked newest-first, each with the station of its latest
// spin for chip context. Server-side bounded so it is immune to calendar
// midnight boundaries and per-station timeline caps. Public + user-independent
// → short in-memory cache.
const RECENT_ARTIST_LIMIT = 24;
const RECENT_ARTISTS_WINDOW = sql`INTERVAL '4 hours'`;
const RECENT_ARTISTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let _recentArtistsCache: {
  builtAt: number;
  artists: {
    artist: string;
    artistMbid: string | null;
    playCount: number;
    stationSlug: string;
    stationName: string;
  }[];
} | null = null;

router.get("/stations/recent-artists", h(async (_req, res) => {
  if (_recentArtistsCache && Date.now() - _recentArtistsCache.builtAt < RECENT_ARTISTS_CACHE_TTL_MS) {
    return res.json(GetStationsRecentArtistsResponse.parse({ artists: _recentArtistsCache.artists }));
  }

  const rows = await db.execute<{
    artist: string;
    artist_mbid: string | null;
    play_count: number;
    station_slug: string;
    station_name: string;
  }>(sql`
    WITH recent AS (
      SELECT
        COALESCE(
          'mbid:' || r.artist_mbid,
          'name:' || lower(regexp_replace(r.artist, '[^[:alnum:]]', '', 'g'))
        ) AS artist_key,
        r.artist,
        r.artist_mbid,
        sp.played_at,
        s.slug AS station_slug,
        s.name AS station_name
      FROM spins sp
      INNER JOIN stations s
        ON s.id = sp.station_id
       AND s.active = true
       AND s.hidden = false
      INNER JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.mbid IS NOT NULL
        AND sp.played_at >= NOW() - ${RECENT_ARTISTS_WINDOW}
        AND r.artist IS NOT NULL
        AND length(trim(r.artist)) > 0
    )
    SELECT
      min(artist)::text AS artist,
      max(artist_mbid)::text AS artist_mbid,
      count(*)::int AS play_count,
      (array_agg(station_slug ORDER BY played_at DESC))[1]::text AS station_slug,
      (array_agg(station_name ORDER BY played_at DESC))[1]::text AS station_name,
      max(played_at) AS last_played_at
    FROM recent
    GROUP BY artist_key
    ORDER BY last_played_at DESC, lower(min(artist)), min(artist)
    LIMIT ${RECENT_ARTIST_LIMIT}
  `);

  const artists = rows.rows.map((row) => ({
    artist: row.artist,
    artistMbid: row.artist_mbid,
    playCount: Number(row.play_count),
    stationSlug: row.station_slug,
    stationName: row.station_name,
  }));
  _recentArtistsCache = { builtAt: Date.now(), artists };
  return res.json(GetStationsRecentArtistsResponse.parse({ artists }));
}));

// GET /api/djs/:name
// Returns all scraped upcoming shows for a given DJ name across stations.
router.get("/djs/:name", h(async (req, res) => {
  const djName = decodeURIComponent(String(req.params.name ?? ""));
  if (!djName) return res.status(400).json({ error: "DJ name required" });

  const rows = await db
    .select({
      stationId: scrapedShowsTable.stationId,
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      showName: scrapedShowsTable.showName,
      dayOfWeek: scrapedShowsTable.dayOfWeek,
      startTime: scrapedShowsTable.startTime,
      endTime: scrapedShowsTable.endTime,
    })
    .from(scrapedShowsTable)
    .innerJoin(stationsTable, eq(scrapedShowsTable.stationId, stationsTable.id))
    .where(
      and(
        eq(scrapedShowsTable.djName, djName),
        eq(stationsTable.hidden, false),
        isNull(scrapedShowsTable.voidedAt),
      ),
    )
    .orderBy(asc(stationsTable.name), asc(scrapedShowsTable.dayOfWeek), asc(scrapedShowsTable.startTime));

  if (rows.length === 0) {
    return res.status(404).json({ error: "DJ not found" });
  }

  // Deduplicate: two stations with identical schedules (e.g. KEXP + KEXP Seattle)
  // yield the same show row. Keep only the first station encountered per fingerprint.
  const seen = new Set<string>();
  const deduped = rows.filter((r) => {
    const fp = `${r.showName}|${r.dayOfWeek}|${r.startTime}`;
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });

  return res.json({
    djName,
    shows: deduped.map((r) => ({
      stationSlug: r.stationSlug,
      stationName: r.stationName,
      showName: r.showName,
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      endTime: r.endTime,
    })),
  });
}));

// GET /api/stations/:slug/upcoming-schedule
// Returns the station's own scraped weekly programming grid (name/day/time),
// distinct from /stations/schedule which is derived from logged spins.
router.get("/stations/:slug/upcoming-schedule", h(async (req, res) => {
  const { slug } = GetStationUpcomingScheduleParams.parse(req.params);

  const station = await db
    .select({
      id: stationsTable.id,
      slug: stationsTable.slug,
      scheduleScrapedAt: stationsTable.scheduleScrapedAt,
      ianaTimezone: stationsTable.ianaTimezone,
    })
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);

  if (station.length === 0) {
    return res.status(404).json({ error: "Station not found" });
  }

  const dayRank = sql<number>`array_position(
    array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
    ${scrapedShowsTable.dayOfWeek}
  )`;
  const rows = await db
    .select({
      showName: scrapedShowsTable.showName,
      dayOfWeek: scrapedShowsTable.dayOfWeek,
      startTime: scrapedShowsTable.startTime,
      endTime: scrapedShowsTable.endTime,
      djName: scrapedShowsTable.djName,
      sourceUrl: scrapedShowsTable.sourceUrl,
      scrapedAt: scrapedShowsTable.scrapedAt,
      extraction: scrapedShowsTable.extraction,
    })
    .from(scrapedShowsTable)
    .where(
      and(
        eq(scrapedShowsTable.stationId, station[0]!.id),
        isNull(scrapedShowsTable.voidedAt),
      ),
    )
    .orderBy(asc(dayRank), asc(scrapedShowsTable.startTime));

  // Freshness comes from stationsTable.scheduleScrapedAt (set on every
  // successful scrape, including a legitimate empty result) rather than from
  // row data — otherwise a station with a real, successfully-confirmed empty
  // schedule would be indistinguishable from one that's never been scraped.
  const lastScrapedAt = station[0]!.scheduleScrapedAt
    ? station[0]!.scheduleScrapedAt.toISOString()
    : null;

  // Read the stored IANA timezone (written by migration backfill + seed).
  // Null means inference was not confident enough — the UI degrades gracefully.
  const timezoneHint = station[0]!.ianaTimezone ?? null;

  return res.json(
    GetStationUpcomingScheduleResponse.parse({
      stationSlug: station[0]!.slug,
      shows: rows.map((r) => ({
        showName: r.showName,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        djName: r.djName ?? null,
        sourceUrl: r.sourceUrl,
        scrapedAt: r.scrapedAt,
        extraction: r.extraction,
      })),
      lastScrapedAt,
      timezoneHint,
    }),
  );
}));

// ---------------------------------------------------------------------------
// GET /api/scraped-shows — all stations' weekly scraped show slots (for calendar)
// ---------------------------------------------------------------------------

// Insight lookup maps for schedule enrichment: match each scraped slot to a
// logged show (by station + show name, falling back to station + DJ name) or
// a DJ picker (by DJ name), and attach that entity's cached genre profile +
// discovery score. Cached columns are written by the insights job — nothing
// is computed here, so an unmatched or not-yet-scored slot simply carries no
// insights.
//
// Building these maps reads the full shows + pickers tables on every request,
// which is the schedule page's main hotspot as stations grow — so the built
// maps are cached in memory with a short TTL and refreshed naturally on
// expiry. Staleness is bounded and harmless: the underlying genre profiles
// are themselves only rewritten by a periodic insights job.
type Insight = {
  genres: string[];
  discoveryScore: number | null;
  discoveryLabel: string | null;
};

type InsightMaps = {
  showByName: Map<string, Insight | null>;
  showByDj: Map<string, Insight | null>;
  pickerByDj: Map<string, Insight | null>;
};

export const INSIGHT_MAPS_TTL_MS = 5 * 60 * 1000;
let insightMapsCache: { builtAt: number; promise: Promise<InsightMaps>; settled: boolean } | null = null;

// Injectable seam — replaced in tests so DB interactions can be controlled
// without spying on drizzle internals.  In production this always points to
// the real implementation below.
let _insightMapsBuilder: () => Promise<InsightMaps> = buildInsightMapsImpl;

/** Test-only: replace the builder (call resetInsightMapsBuilder in afterEach). */
export function _configureInsightMapsBuilder(fn: () => Promise<InsightMaps>): void {
  _insightMapsBuilder = fn;
}

/** Test-only: restore the real builder and clear the cache. */
export function _resetInsightMapsBuilder(): void {
  _insightMapsBuilder = buildInsightMapsImpl;
  insightMapsCache = null;
}

/** Test-only: clear the cache without touching the builder. */
export function _resetInsightMapsCache(): void {
  insightMapsCache = null;
}

async function buildInsightMaps(): Promise<InsightMaps> {
  return _insightMapsBuilder();
}

async function buildInsightMapsImpl(): Promise<InsightMaps> {
  const loggedShows = await db
    .select({
      stationId: showsTable.stationId,
      name: showsTable.name,
      djName: showsTable.djName,
      genreProfile: showsTable.genreProfile,
      discoveryScore: showsTable.discoveryScore,
    })
    .from(showsTable)
    .where(isNotNull(showsTable.genreProfile));
  const djPickers = await db
    .select({
      name: pickersTable.name,
      genreProfile: pickersTable.genreProfile,
      discoveryScore: pickersTable.discoveryScore,
    })
    .from(pickersTable)
    .where(and(eq(pickersTable.pickerType, "dj"), isNotNull(pickersTable.genreProfile)));

  const toInsight = (row: {
    genreProfile: { top: Array<{ genre: string; count: number }> } | null;
    discoveryScore: number | null;
  }): Insight | null => {
    const genres = row.genreProfile?.top.slice(0, 4).map((g) => g.genre) ?? [];
    if (genres.length === 0 && row.discoveryScore == null) return null;
    return {
      genres,
      discoveryScore: row.discoveryScore,
      discoveryLabel: row.discoveryScore != null ? labelFromScore(row.discoveryScore) : null,
    };
  };

  const showByName = new Map<string, Insight | null>();
  const showByDj = new Map<string, Insight | null>();
  for (const s of loggedShows) {
    const insight = toInsight(s);
    showByName.set(`${s.stationId}|${s.name.trim().toLowerCase()}`, insight);
    if (s.djName) {
      const key = `${s.stationId}|${s.djName.trim().toLowerCase()}`;
      // First match wins so a DJ with several shows keeps a stable profile.
      if (!showByDj.has(key)) showByDj.set(key, insight);
    }
  }
  const pickerByDj = new Map<string, Insight | null>();
  for (const p of djPickers) {
    const key = p.name.trim().toLowerCase();
    if (!pickerByDj.has(key)) pickerByDj.set(key, toInsight(p));
  }

  return { showByName, showByDj, pickerByDj };
}

// Cache the in-flight promise (not just the resolved value) so concurrent
// requests during a cold/expired window share one rebuild instead of each
// firing their own full-table reads.
//
// The TTL check is gated on `settled`: if the promise is still in-flight
// when the TTL clock ticks past expiry, later callers reuse the same
// in-flight promise rather than kicking off a second redundant build.
// A failed build is evicted immediately (settled=true + cache cleared) so
// the next request retries rather than caching the error for the full TTL.
export function getInsightMaps(): Promise<InsightMaps> {
  const now = Date.now();
  if (
    !insightMapsCache ||
    (insightMapsCache.settled && now - insightMapsCache.builtAt >= INSIGHT_MAPS_TTL_MS)
  ) {
    const entry: { builtAt: number; promise: Promise<InsightMaps>; settled: boolean } = {
      builtAt: now,
      promise: buildInsightMaps(),
      settled: false,
    };
    entry.promise.then(
      () => { entry.settled = true; },
      () => {
        entry.settled = true;
        if (insightMapsCache === entry) insightMapsCache = null;
      }
    );
    insightMapsCache = entry;
  }
  return insightMapsCache.promise;
}

router.get("/scraped-shows", h(async (_req, res) => {
  const rows = await db
    .select({
      stationId: scrapedShowsTable.stationId,
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      stationCity: stationsTable.city,
      stationCountry: stationsTable.country,
      showName: scrapedShowsTable.showName,
      dayOfWeek: scrapedShowsTable.dayOfWeek,
      startTime: scrapedShowsTable.startTime,
      endTime: scrapedShowsTable.endTime,
      djName: scrapedShowsTable.djName,
      sourceUrl: scrapedShowsTable.sourceUrl,
      scrapedAt: scrapedShowsTable.scrapedAt,
      extraction: scrapedShowsTable.extraction,
    })
    .from(scrapedShowsTable)
    .innerJoin(stationsTable, eq(scrapedShowsTable.stationId, stationsTable.id))
    .where(eq(stationsTable.hidden, false))
    .orderBy(stationsTable.name, scrapedShowsTable.dayOfWeek, scrapedShowsTable.startTime);

  const { showByName, showByDj, pickerByDj } = await getInsightMaps();

  const insightForSlot = (slot: {
    stationId: number;
    showName: string;
    djName: string | null;
  }): Insight | null => {
    const byName = showByName.get(`${slot.stationId}|${slot.showName.trim().toLowerCase()}`);
    if (byName) return byName;
    if (slot.djName) {
      const dj = slot.djName.trim().toLowerCase();
      const byDj = showByDj.get(`${slot.stationId}|${dj}`);
      if (byDj) return byDj;
      const byPicker = pickerByDj.get(dj);
      if (byPicker) return byPicker;
    }
    return null;
  };

  // Group rows by station slug
  const bySlug = new Map<string, { slug: string; name: string; city: string | null; country: string | null; shows: typeof rows }>();
  for (const row of rows) {
    if (!bySlug.has(row.stationSlug)) {
      bySlug.set(row.stationSlug, { slug: row.stationSlug, name: row.stationName, city: row.stationCity, country: row.stationCountry, shows: [] });
    }
    bySlug.get(row.stationSlug)!.shows.push(row);
  }

  // Deduplicate stations whose show sets are identical (e.g. two DB rows for
  // the same station scraped under different slugs). Fingerprint = sorted join
  // of "showName|dayOfWeek|startTime" tuples. For each group of duplicates,
  // keep the entry with the shortest name (most canonical).
  const byFingerprint = new Map<string, typeof bySlug extends Map<string, infer V> ? V : never>();
  for (const station of bySlug.values()) {
    const fp = station.shows
      .map((s) => `${s.showName}|${s.dayOfWeek}|${s.startTime}`)
      .sort()
      .join(",");
    const existing = byFingerprint.get(fp);
    if (!existing || station.name.length < existing.name.length) {
      byFingerprint.set(fp, station);
    }
  }

  return res.json({
    stations: [...byFingerprint.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({
      slug: s.slug,
      name: s.name,
      timezoneHint: inferTimezone(s.city ?? null, s.country ?? null),
      shows: s.shows.map((r) => {
        const insight = insightForSlot(r);
        return {
          showName: r.showName,
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime ?? null,
          djName: r.djName ?? null,
          sourceUrl: r.sourceUrl,
          scrapedAt: r.scrapedAt,
          extraction: r.extraction,
          genres: insight?.genres ?? [],
          discoveryScore: insight?.discoveryScore ?? null,
          discoveryLabel: insight?.discoveryLabel ?? null,
        };
      }),
    })),
  });
}));

export default router;
