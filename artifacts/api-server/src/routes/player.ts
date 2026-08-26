import { Router, type IRouter } from "express";
import {
  db,
  listenerDb,
  type Station,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  libraryItemsTable,
  trackClaimsTable,
  songExploderEpisodesTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  picksTable,
  pickersTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, isNotNull, isNull, gte } from "drizzle-orm";
import { getUserForListenerRead, getUserFromSession } from "../lore/userSession.js";
import { toStation, isPickerOptedOut, validScheduleShowAttribution, deriveStationCategories } from "./lore/shared.js";
import { classifyFreshness } from "../lore/freshness.js";
import { estimateExpiry } from "../lore/expiry.js";
import { pollStation } from "../lore/poller.js";
import { spinDayExpr } from "../lore/runs.js";
import { h } from "../middlewares/asyncHandler.js";

/**
 * Webplayer read-models — plain-JSON endpoints consumed by the /player front
 * end via hand-written fetch hooks (no OpenAPI/orval involvement, mirroring
 * the /api/me/* pattern). All endpoints work anonymously; when a session
 * exists, library-overlap fields are populated.
 *
 * Mounted BEFORE loreRouter (admin catch-all would otherwise 503 these).
 */
const router: IRouter = Router();

/** A station is "on the air" if it logged a spin within this window. */
const ON_AIR_WINDOW_MS = 90 * 60 * 1000;
/** Earlier-artist summaries look back this far. */
const EARLIER_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Max earlier artists shown per row. */
const EARLIER_MAX = 3;
/** Max MBIDs per lore-counts batch. */
const LORE_COUNTS_MAX = 60;
/** Deep-cut cards in the run drawer trove. */
const DEEP_CUTS_MAX = 3;

type HistoryScope = "now" | "set" | "24h" | "7d" | "lifetime";
type HistoryFilter = "all" | "crossings" | "firstPlays";
const HISTORY_SCOPES = new Set<HistoryScope>(["now", "set", "24h", "7d", "lifetime"]);
const HISTORY_FILTERS = new Set<HistoryFilter>(["all", "crossings", "firstPlays"]);
const HISTORY_CATEGORIES = new Set(["ambient", "campus", "specialist", "anchor", "public", "indie", "discovery"]);
const HISTORY_PAGE_MAX = 60;

/**
 * Bounded, stable archive read model for both Dial surfaces. This deliberately
 * stays a plain JSON endpoint: history is a read model, not a generated
 * contract, and the scanner can continue a snapshot with a keyset cursor.
 */
router.get("/player/history", h(async (req, res) => {
  const scope = (typeof req.query.scope === "string" ? req.query.scope : "lifetime") as HistoryScope;
  const filter = (typeof req.query.filter === "string" ? req.query.filter : "all") as HistoryFilter;
  // The scanner moves forward through a fixed archive snapshot, while the
  // front-door discovery rail needs the newest arrivals first. Keep the
  // scanner's chronological default and make recency an explicit opt-in.
  const newestFirst = req.query.order === "desc";
  if (!HISTORY_SCOPES.has(scope) || !HISTORY_FILTERS.has(filter)) {
    return res.status(400).json({ error: "Invalid history scope or filter" });
  }
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 40;
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), HISTORY_PAGE_MAX) : 40;
  const stationSlug = typeof req.query.station === "string" && req.query.station.trim()
    ? req.query.station.trim()
    : null;
  const categories = typeof req.query.categories === "string"
    ? req.query.categories.split(",").map((v) => v.trim()).filter((v) => HISTORY_CATEGORIES.has(v))
    : [];
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  const beforeId = typeof req.query.beforeId === "string" && /^\d+$/.test(req.query.beforeId)
    ? Number(req.query.beforeId) : null;
  const snapshot = typeof req.query.snapshot === "string" ? new Date(req.query.snapshot) : new Date();
  if (Number.isNaN(snapshot.getTime()) || (before && Number.isNaN(before.getTime()))) {
    return res.status(400).json({ error: "Invalid history cursor" });
  }

  // This narrow public fast lane is only for the home rail. A request that
  // merely happens to carry `surface=home` must keep the regular archive
  // semantics, including cursoring and listener personalization.
  const isHomeFirstPlayRail =
    (req.query.home === "1" || req.query.surface === "home") &&
    scope === "7d" &&
    filter === "firstPlays" &&
    newestFirst &&
    limit === 18 &&
    stationSlug == null &&
    categories.length === 0 &&
    before == null &&
    beforeId == null &&
    typeof req.query.snapshot !== "string";
  const useHomeFastLane = isHomeFirstPlayRail;
  const user = isHomeFirstPlayRail ? null : await getUserFromSession(req).catch(() => null);
  const historyDb = useHomeFastLane ? listenerDb : db;
  const userLibrary = user
    ? db.select({ mbid: libraryItemsTable.mbid }).from(libraryItemsTable)
        .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt)))
    : null;
  const userArtists = user
    ? db.select({ artistMbid: recordingsTable.artistMbid })
        .from(recordingsTable)
        .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
        .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt), isNotNull(recordingsTable.artistMbid)))
    : null;

  let stationIds: number[] | null = null;
  if (!useHomeFastLane) {
    const stationRows = await historyDb.select().from(stationsTable).where(eq(stationsTable.hidden, false));
    const eligibleStations = stationRows.filter((station) => {
      if (stationSlug && station.slug !== stationSlug) return false;
      if (categories.length > 0 && !categories.some((cat) => deriveStationCategories(station).includes(cat))) return false;
      return true;
    });
    if (stationSlug && eligibleStations.length === 0) return res.status(404).json({ error: "Station not found" });
    if (eligibleStations.length === 0) {
      return res.json({ snapshot: snapshot.toISOString(), items: [], nextBefore: null, partial: false, authenticated: user != null });
    }
    stationIds = eligibleStations.map((station) => station.id);
  }

  const scopeSince =
    scope === "now" ? new Date(snapshot.getTime() - 2 * 60 * 60 * 1000) :
    scope === "set" ? new Date(Date.UTC(snapshot.getUTCFullYear(), snapshot.getUTCMonth(), snapshot.getUTCDate())) :
    scope === "24h" ? new Date(snapshot.getTime() - 24 * 60 * 60 * 1000) :
    scope === "7d" ? new Date(snapshot.getTime() - 7 * 24 * 60 * 60 * 1000) : null;
  const predicates = [
    useHomeFastLane
      ? eq(stationsTable.hidden, false)
      : inArray(spinsTable.stationId, stationIds!),
    isNotNull(spinsTable.mbid),
    sql`${spinsTable.playedAt} <= ${snapshot}`,
    scopeSince ? sql`${spinsTable.playedAt} >= ${scopeSince}` : undefined,
    before
      ? newestFirst
        ? (beforeId != null
          ? sql`(${spinsTable.playedAt} < ${before} OR (${spinsTable.playedAt} = ${before} AND ${spinsTable.id} < ${beforeId}))`
          : sql`${spinsTable.playedAt} < ${before}`)
        : (beforeId != null
          ? sql`(${spinsTable.playedAt} > ${before} OR (${spinsTable.playedAt} = ${before} AND ${spinsTable.id} > ${beforeId}))`
          : sql`${spinsTable.playedAt} > ${before}`)
      : undefined,
  ].filter((p): p is NonNullable<typeof p> => p != null);
  const libraryHit = userLibrary
    ? sql`(${spinsTable.mbid} in (${userLibrary}) OR ${recordingsTable.artistMbid} in (${userArtists}))`
    : sql`false`;
  if (filter === "crossings") predicates.push(libraryHit);
  if (filter === "firstPlays") {
    predicates.push(sql`NOT EXISTS (
      SELECT 1 FROM spins prior
      WHERE prior.mbid = ${spinsTable.mbid}
        AND (prior.played_at < ${spinsTable.playedAt}
          OR (prior.played_at = ${spinsTable.playedAt} AND prior.id < ${spinsTable.id}))
    )`);
    // The home "New" rail follows the Dial's existing First/premiere
    // definition, not the broader archive "first time Lore saw this MBID"
    // meaning. Release dates preserve MusicBrainz's partial precision:
    // year-only means year-end and month-only means month-end. If a full
    // date is absent, the established year fallback remains in place.
    if (useHomeFastLane) {
      predicates.push(sql`CASE
        WHEN ${recordingsTable.releaseDate} ~ '^[0-9]{4}$'
          THEN ${spinsTable.playedAt}::date <= (${recordingsTable.releaseDate} || '-12-31')::date
        WHEN ${recordingsTable.releaseDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          THEN ${spinsTable.playedAt}::date <= (
            date_trunc('month', (${recordingsTable.releaseDate} || '-01')::date)
            + interval '1 month - 1 day'
          )::date
        WHEN ${recordingsTable.releaseDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          THEN to_char(${spinsTable.playedAt}, 'YYYY-MM-DD') <= ${recordingsTable.releaseDate}
        WHEN ${recordingsTable.releaseYear} IS NOT NULL
          THEN extract(year from ${spinsTable.playedAt})::integer <= ${recordingsTable.releaseYear}
        ELSE false
      END`);
    }
    if (user) predicates.push(libraryHit);
  }
  const rows = await historyDb.select({
    id: spinsTable.id,
    mbid: recordingsTable.mbid,
    title: recordingsTable.title,
    artist: recordingsTable.artist,
    artistMbid: recordingsTable.artistMbid,
    artworkUrl: recordingsTable.artworkUrl,
    releaseYear: recordingsTable.releaseYear,
    releaseDate: recordingsTable.releaseDate,
    isCrossing: libraryHit,
    isFirstPlay: useHomeFastLane ? sql<boolean>`true` : sql<boolean>`NOT EXISTS (
      SELECT 1 FROM spins prior
      WHERE prior.mbid = ${spinsTable.mbid}
        AND (prior.played_at < ${spinsTable.playedAt}
          OR (prior.played_at = ${spinsTable.playedAt} AND prior.id < ${spinsTable.id}))
    )`,
    playedAt: spinsTable.playedAt,
    stationSlug: stationsTable.slug,
    stationName: stationsTable.name,
    showName: showsTable.name,
    showDj: showsTable.djName,
  }).from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(
      showsTable,
      useHomeFastLane
        ? eq(spinsTable.showId, showsTable.id)
        : and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(and(...predicates))
    .orderBy(
      newestFirst ? desc(spinsTable.playedAt) : asc(spinsTable.playedAt),
      newestFirst ? desc(spinsTable.id) : asc(spinsTable.id),
    )
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return res.json({
    snapshot: snapshot.toISOString(),
    items: page.map((row) => ({
      id: row.id,
      mbid: row.mbid,
      title: row.title,
      artist: row.artist,
      artistMbid: row.artistMbid,
      artworkUrl: row.artworkUrl ?? null,
      releaseYear: row.releaseYear ?? null,
      releaseDate: row.releaseDate ?? null,
      playedAt: row.playedAt.toISOString(),
      station: { slug: row.stationSlug, name: row.stationName },
      show: row.showName ? { name: row.showName, djName: row.showDj ?? null } : null,
      isCrossing: Boolean(row.isCrossing),
      isFirstPlay: Boolean(row.isFirstPlay),
    })),
    nextBefore: rows.length > limit && last ? last.playedAt.toISOString() : null,
    nextBeforeId: rows.length > limit && last ? last.id : null,
    partial: false,
    authenticated: user != null,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/onair — live stations sorted by the user's library overlap
// ---------------------------------------------------------------------------

router.get("/player/onair", h(async (req, res) => {
  const user = await getUserForListenerRead(req);

  const stations = await listenerDb
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)));

  // Fetch only the most-recent ID per visible station through the
  // station/time index instead of sorting the whole spin archive.
  const latestSpinIds =
    stations.length === 0
      ? []
      : (await listenerDb.execute<{ id: number }>(sql`
          SELECT latest.id
          FROM unnest(
            ARRAY[${sql.join(stations.map((station) => sql`${station.id}`), sql`, `)}]::integer[]
          ) AS target(station_id)
          JOIN LATERAL (
            SELECT sp.id
            FROM spins sp
            WHERE sp.station_id = target.station_id
            ORDER BY sp.played_at DESC, sp.id DESC
            LIMIT 1
          ) AS latest ON true
        `)).rows.map((row) => row.id);
  const latest = latestSpinIds.length === 0 ? [] : await listenerDb
    .selectDistinctOn([spinsTable.stationId], {
      stationId: spinsTable.stationId,
      playedAt: spinsTable.playedAt,
      // Rows predating the observed_at column fall back to created_at.
      observedAt: sql<Date>`coalesce(${spinsTable.observedAt}, ${spinsTable.createdAt})`.mapWith(spinsTable.createdAt),
      source: spinsTable.source,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(inArray(spinsTable.id, latestSpinIds))
    .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

  // Recent spins for "earlier: A, B, C" summaries.
  const earlierSince = new Date(Date.now() - EARLIER_WINDOW_MS);
  const recent = await listenerDb
    .select({
      stationId: spinsTable.stationId,
      playedAt: spinsTable.playedAt,
      artist: recordingsTable.artist,
      rawArtist: spinsTable.rawArtist,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(gte(spinsTable.playedAt, earlierSince))
    .orderBy(desc(spinsTable.playedAt))
    .limit(600);

  // Library match counts per station (distinct library MBIDs ever spun).
  const matchByStation = new Map<number, number>();
  if (user) {
    const userLib = listenerDb
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt)));
    const rows = await listenerDb
      .select({
        stationId: spinsTable.stationId,
        matches: sql<number>`count(distinct ${spinsTable.mbid})::int`,
      })
      .from(spinsTable)
      .where(and(isNotNull(spinsTable.mbid), inArray(spinsTable.mbid, userLib)))
      .groupBy(spinsTable.stationId);
    for (const r of rows) {
      if (r.stationId != null) matchByStation.set(r.stationId, r.matches);
    }
  }

  const latestByStation = new Map(latest.map((r) => [r.stationId, r]));
  const earlierByStation = new Map<number, string[]>();
  for (const r of recent) {
    if (r.stationId == null) continue;
    const name = r.artist ?? r.rawArtist;
    if (!name) continue;
    const list = earlierByStation.get(r.stationId) ?? [];
    if (list.length === 0) {
      // First (most recent) entry per station is the "now" artist — skip it.
      earlierByStation.set(r.stationId, [name]);
      continue;
    }
    if (list.length < EARLIER_MAX + 1 && !list.includes(name)) {
      list.push(name);
      earlierByStation.set(r.stationId, list);
    }
  }

  const cutoff = Date.now() - ON_AIR_WINDOW_MS;
  const now = new Date();
  const itemsRaw = stations.map((s) => {
      const spin = latestByStation.get(s.id);
      if (!spin || spin.playedAt.getTime() < cutoff) return null;
      const earlier = (earlierByStation.get(s.id) ?? []).slice(1);
      return {
        station: toStation(
          s,
          undefined,
          s.automationClass === "mixed" ? "automated" : s.automationClass,
        ),
        show:
          spin.showName != null
            ? { name: spin.showName, djName: spin.showDj ?? null }
            : null,
        now: {
          mbid: spin.mbid ?? null,
          title: spin.title ?? spin.rawTitle,
          artist: spin.artist ?? spin.rawArtist,
          artworkUrl: spin.artworkUrl ?? null,
          playedAt: spin.playedAt.toISOString(),
          observedAt: spin.observedAt.toISOString(),
          freshness: classifyFreshness(spin.source, spin.observedAt, now),
          resolved: spin.mbid != null,
        },
        earlier,
        matchCount: user ? matchByStation.get(s.id) ?? 0 : null,
      };
    });
  const items = itemsRaw.filter((x): x is NonNullable<typeof x> => x !== null)
    .sort(
      (a, b) =>
        (b.matchCount ?? -1) - (a.matchCount ?? -1) ||
        new Date(b.now.playedAt).getTime() - new Date(a.now.playedAt).getTime(),
    );

  return res.json({ items, authenticated: user != null });
}));

// ---------------------------------------------------------------------------
// GET /api/player/station/:slug/now — station-landing fast lane.
//
// When a listener stops the scan on (or tunes to) a station, the aggregate
// on-air snapshot can be up to a poll cycle old. This endpoint returns just
// that station's freshest stored state (local read-model — no external
// lookups in the request path) and, when the observation has exceeded its
// source's freshness budget, fire-and-forgets a one-shot targeted poll of
// that station via the existing poller machinery (`pollStation`, which
// honors the per-station in-flight guard). A short per-station debounce
// coalesces repeated landings so a source can never be hammered.
// ---------------------------------------------------------------------------

/** Minimum gap between fast-lane-triggered refreshes of one station. */
const FAST_LANE_DEBOUNCE_MS = 30_000;
/** stationId → last time the fast lane triggered a refresh (ms epoch). */
const fastLaneLastTrigger = new Map<number, number>();

type FastLaneRefreshFn = (station: Station) => Promise<void>;
let fastLaneRefresh: FastLaneRefreshFn = (station) => pollStation(station);

/** Tests only: swap the one-shot refresh implementation. Returns a restore fn. */
export function _testOnly_setFastLaneRefresh(fn: FastLaneRefreshFn): () => void {
  const prev = fastLaneRefresh;
  fastLaneRefresh = fn;
  return () => { fastLaneRefresh = prev; };
}

/** Tests only: clear the per-station refresh debounce. */
export function _testOnly_resetFastLaneDebounce(): void {
  fastLaneLastTrigger.clear();
}

router.get("/player/station/:slug/now", h(async (req, res) => {
  const slug = typeof req.params.slug === "string" ? req.params.slug : "";

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) return res.status(404).json({ error: "Station not found" });

  const [spin] = await db
    .select({
      playedAt: spinsTable.playedAt,
      // Rows predating the observed_at column fall back to created_at.
      observedAt: sql<Date>`coalesce(${spinsTable.observedAt}, ${spinsTable.createdAt})`.mapWith(spinsTable.createdAt),
      source: spinsTable.source,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      releaseYear: recordingsTable.releaseYear,
      durationMs: recordingsTable.durationMs,
      playOffsetMs: spinsTable.playOffsetMs,
      offsetCapturedAt: spinsTable.offsetCapturedAt,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(eq(spinsTable.stationId, station.id))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  const now = new Date();
  const freshness = spin ? classifyFreshness(spin.source, spin.observedAt, now) : null;

  // Advisory expiry estimate: when the recording's duration is known, how
  // much of the song is likely left. Null when duration (or a position
  // signal) is absent — no estimate, no penalty. This never changes which
  // track is reported; the client only uses it to schedule a re-check just
  // past the estimated boundary instead of trusting an about-to-expire track.
  const expiry = spin
    ? estimateExpiry({
        durationMs: spin.durationMs,
        playedAt: spin.playedAt,
        playOffsetMs: spin.playOffsetMs,
        offsetCapturedAt: spin.offsetCapturedAt,
        now,
      })
    : null;

  // "Fresh" means within the source's freshness budget — anything past it
  // (aging/stale, or no stored spin at all) warrants a one-shot re-poll.
  let refreshTriggered = false;
  if (freshness !== "fresh") {
    const last = fastLaneLastTrigger.get(station.id) ?? 0;
    if (now.getTime() - last >= FAST_LANE_DEBOUNCE_MS) {
      fastLaneLastTrigger.set(station.id, now.getTime());
      refreshTriggered = true;
      void fastLaneRefresh(station).catch((err) => {
        console.error("[lore] fast-lane refresh failed", station.slug, err);
      });
    }
  }

  return res.json({
    station: { slug: station.slug, name: station.name },
    now: spin
      ? {
          mbid: spin.mbid ?? null,
          artistMbid: spin.artistMbid ?? null,
          title: spin.title ?? spin.rawTitle,
          artist: spin.artist ?? spin.rawArtist,
          artworkUrl: spin.artworkUrl ?? null,
          releaseYear: spin.releaseYear ?? null,
          playedAt: spin.playedAt.toISOString(),
          observedAt: spin.observedAt.toISOString(),
          freshness,
          resolved: spin.mbid != null,
          estimatedRemainingMs: expiry?.remainingMs ?? null,
          likelyExpiring: expiry?.likelyExpiring ?? false,
        }
      : null,
    refreshTriggered,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/run/:slug — tonight's run for a station, split by library
// ---------------------------------------------------------------------------

router.get("/player/run/:slug", h(async (req, res) => {
  const slug = typeof req.params.slug === "string" ? req.params.slug : "";
  const user = await getUserFromSession(req).catch(() => null);

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) return res.status(404).json({ error: "Station not found" });

  // Anchor: by default the station's latest spin defines tonight's
  // (show, UTC day) run. With ?runId=<anchor spin id> (the min-spin-id run
  // anchor used across the archive) a specific past run is requested instead
  // — that spin's show + UTC day become the partition.
  const runIdRaw = typeof req.query.runId === "string" ? req.query.runId : "";
  const runId = /^\d+$/.test(runIdRaw) ? Number(runIdRaw) : null;

  const anchorQuery = db
    .select({
      showId: spinsTable.showId,
      day: sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    );

  const [anchor] =
    runId != null
      ? await anchorQuery
          .where(and(eq(spinsTable.id, runId), eq(spinsTable.stationId, station.id)))
          .limit(1)
      : await anchorQuery
          .where(eq(spinsTable.stationId, station.id))
          .orderBy(desc(spinsTable.playedAt))
          .limit(1);
  if (!anchor)
    return res.status(404).json({
      error: runId != null ? "Run not found for this station" : "No spins for this station yet",
    });

  const partition = and(
    eq(spinsTable.stationId, station.id),
    anchor.showId == null
      ? sql`${spinsTable.showId} is null`
      : eq(spinsTable.showId, anchor.showId),
    sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${anchor.day}`,
  );

  const spins = await db
    .select({
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(partition)
    .orderBy(desc(spinsTable.playedAt))
    .limit(200);

  // Which of tonight's resolved MBIDs are in the user's library?
  const resolvedMbids = [...new Set(spins.map((s) => s.mbid).filter((m): m is string => m != null))];
  const inLib = new Set<string>();
  if (user && resolvedMbids.length > 0) {
    const rows = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, user.id),
          isNull(libraryItemsTable.removedAt),
          inArray(libraryItemsTable.mbid, resolvedMbids),
        ),
      );
    for (const r of rows) inLib.add(r.mbid);
  }

  const items = spins.map((s) => ({
    mbid: s.mbid ?? null,
    title: s.title ?? s.rawTitle,
    artist: s.artist ?? s.rawArtist,
    artworkUrl: s.artworkUrl ?? null,
    playedAt: s.playedAt.toISOString(),
    resolved: s.mbid != null,
    inLibrary: s.mbid != null && inLib.has(s.mbid),
  }));

  const resolvedCount = items.filter((i) => i.resolved).length;
  const ownedCount = items.filter((i) => i.inLibrary).length;
  const overlapPct =
    user && resolvedCount > 0 ? Math.round((100 * ownedCount) / resolvedCount) : null;

  // ── Selector trove: shared recordings + deep cuts from past runs ─────────
  let trove: {
    selectorName: string;
    sharedCount: number;
    deepCuts: Array<{ artist: string; spinCount: number; runCount: number }>;
  } | null = null;

  if (user && anchor.showId != null) {
    const userLib = db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, user.id), isNull(libraryItemsTable.removedAt)));

    const [shared] = await db
      .select({ n: sql<number>`count(distinct ${spinsTable.mbid})::int` })
      .from(spinsTable)
      .where(
        and(
          eq(spinsTable.showId, anchor.showId),
          isNotNull(spinsTable.mbid),
          inArray(spinsTable.mbid, userLib),
        ),
      );

    const tonightArtists = new Set(
      items.map((i) => i.artist?.toLowerCase()).filter(Boolean),
    );

    const cuts = await db
      .select({
        artist: recordingsTable.artist,
        spinCount: sql<number>`count(*)::int`,
        runCount: sql<number>`count(distinct to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::int`,
      })
      .from(spinsTable)
      .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(spinsTable.showId, anchor.showId),
          sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') <> ${anchor.day}`,
          sql`${spinsTable.mbid} not in (${userLib})`,
        ),
      )
      .groupBy(recordingsTable.artist)
      .orderBy(sql`count(*) desc`)
      .limit(DEEP_CUTS_MAX + 6);

    trove = {
      selectorName: anchor.showDj ?? anchor.showName ?? station.name,
      sharedCount: shared?.n ?? 0,
      deepCuts: cuts
        .filter((c) => !tonightArtists.has(c.artist.toLowerCase()))
        .slice(0, DEEP_CUTS_MAX)
        .map((c) => ({ artist: c.artist, spinCount: c.spinCount, runCount: c.runCount })),
    };
  }

  return res.json({
    station: { slug: station.slug, name: station.name },
    show:
      anchor.showName != null
        ? { name: anchor.showName, djName: anchor.showDj ?? null }
        : null,
    day: anchor.day,
    spinCount: items.length,
    overlapPct,
    fromLibrary: items.filter((i) => i.inLibrary),
    newToYou: items.filter((i) => !i.inLibrary),
    trove,
    authenticated: user != null,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/for-you — top 5 past runs ranked by library overlap
// ---------------------------------------------------------------------------

router.get("/player/for-you", h(async (req, res) => {
  const user = await getUserFromSession(req).catch(() => null);
  if (!user) return res.status(401).json({ error: "Login required" });

  // CTE: user's library MBIDs
  // Aggregate spins into (station, show, UTC-day) run partitions, counting
  // how many resolved MBIDs overlap the user's library. Returns top 5 by
  // overlap%, ties broken by recency (most recent run first).
  const result = await db.execute(sql`
    WITH user_lib AS (
      SELECT mbid FROM library_items WHERE user_id = ${user.id}
    )
    SELECT
      st.slug,
      st.name                                               AS station_name,
      sh.id                                                 AS show_id,
      sh.name                                               AS show_name,
      sh.dj_name,
      to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      MIN(s.id)::int                                        AS run_id,
      COUNT(DISTINCT s.mbid) FILTER (WHERE s.mbid IS NOT NULL)::int
                                                            AS total_resolved,
      COUNT(DISTINCT s.mbid) FILTER (
        WHERE s.mbid IN (SELECT mbid FROM user_lib)
      )::int                                                AS match_count,
      ROUND(
        100.0
        * COUNT(DISTINCT s.mbid) FILTER (
            WHERE s.mbid IN (SELECT mbid FROM user_lib)
          )
        / NULLIF(
            COUNT(DISTINCT s.mbid) FILTER (WHERE s.mbid IS NOT NULL),
            0
          )
      )::int                                                AS overlap_pct
    FROM   spins s
    JOIN   stations st ON s.station_id = st.id AND st.hidden = false
    LEFT JOIN shows sh
      ON s.show_id = sh.id
      AND ${validScheduleShowAttribution(
        sql`s.station_id`,
        sql`s.played_at`,
        sql`sh.name`,
        sql`sh.picker_id`,
      )}
    WHERE  s.station_id IS NOT NULL
      AND  s.played_at  >= NOW() - INTERVAL '90 days'
    GROUP BY
      st.slug, st.name,
      sh.id, sh.name, sh.dj_name,
      to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    HAVING COUNT(DISTINCT s.mbid) FILTER (
      WHERE s.mbid IN (SELECT mbid FROM user_lib)
    ) > 0
    ORDER BY overlap_pct DESC, day DESC
    LIMIT 5
  `);

  const rows = result.rows as Array<{
    slug: string;
    station_name: string;
    show_id: number | null;
    show_name: string | null;
    dj_name: string | null;
    day: string;
    run_id: number;
    total_resolved: number;
    match_count: number;
    overlap_pct: number;
  }>;

  const runs = rows.map((r) => ({
    slug: r.slug,
    stationName: r.station_name,
    showName: r.show_name ?? null,
    djName: r.dj_name ?? null,
    day: r.day,
    runId: Number(r.run_id),
    totalResolved: Number(r.total_resolved),
    matchCount: Number(r.match_count),
    overlapPct: Number(r.overlap_pct),
  }));

  return res.json({ runs });
}));

// ---------------------------------------------------------------------------
// GET /api/player/lore-counts?mbids=a,b,c — chip counts per recording
// ---------------------------------------------------------------------------

router.get("/player/lore-counts", h(async (req, res) => {
  const raw = typeof req.query.mbids === "string" ? req.query.mbids : "";
  const mbids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(
    0,
    LORE_COUNTS_MAX,
  );
  if (mbids.length === 0) return res.json({ items: [] });

  const user = await getUserFromSession(req).catch(() => null);

  const [claims, seEpisodes, listRows, pickRows, libRows] = await Promise.all([
    db
      .select({
        mbid: trackClaimsTable.mbid,
        n: sql<number>`count(*)::int`,
      })
      .from(trackClaimsTable)
      .where(
        and(
          inArray(trackClaimsTable.mbid, mbids),
          eq(trackClaimsTable.status, "published"),
        ),
      )
      .groupBy(trackClaimsTable.mbid),
    db
      .select({ mbid: songExploderEpisodesTable.mbid })
      .from(songExploderEpisodesTable)
      .where(inArray(songExploderEpisodesTable.mbid, mbids)),
    db
      .select({
        mbid: recordingReleaseGroupsTable.recordingMbid,
        n: sql<number>`count(distinct ${listEntriesTable.listId})::int`,
      })
      .from(listEntriesTable)
      .innerJoin(
        recordingReleaseGroupsTable,
        eq(
          recordingReleaseGroupsTable.releaseGroupMbid,
          listEntriesTable.releaseGroupMbid,
        ),
      )
      .where(
        and(
          inArray(recordingReleaseGroupsTable.recordingMbid, mbids),
          sql`(${listEntriesTable.confidence} = 'exact' OR ${listEntriesTable.confirmed} = true)`,
        ),
      )
      .groupBy(recordingReleaseGroupsTable.recordingMbid),
    db
      .select({
        mbid: picksTable.mbid,
        n: sql<number>`count(distinct (${picksTable.pickerId}, coalesce(${picksTable.sourceUrl}, '')))::int`,
      })
      .from(picksTable)
      .where(inArray(picksTable.mbid, mbids))
      .groupBy(picksTable.mbid),
    user
      ? db
          .select({ mbid: libraryItemsTable.mbid, addedAt: libraryItemsTable.addedAt })
          .from(libraryItemsTable)
          .where(
            and(
              eq(libraryItemsTable.userId, user.id),
              isNull(libraryItemsTable.removedAt),
              inArray(libraryItemsTable.mbid, mbids),
            ),
          )
      : Promise.resolve([] as Array<{ mbid: string; addedAt: Date }>),
  ]);

  const claimMap = new Map(claims.map((r) => [r.mbid, r.n]));
  const seSet = new Set(seEpisodes.map((r) => r.mbid));
  const listMap = new Map(listRows.map((r) => [r.mbid, r.n]));
  const pickMap = new Map(pickRows.filter((r) => r.mbid != null).map((r) => [r.mbid!, r.n]));
  const libMap = new Map(libRows.map((r) => [r.mbid, r.addedAt]));

  return res.json({
    items: mbids.map((mbid) => ({
      mbid,
      artifactCount: (claimMap.get(mbid) ?? 0) + (seSet.has(mbid) ? 1 : 0),
      listCount: (listMap.get(mbid) ?? 0) + (pickMap.get(mbid) ?? 0),
      keptSince: libMap.get(mbid)?.toISOString() ?? null,
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/selectors — selector discovery for the SELECTORS tab.
// All active DJ/curated pickers with at least one logged spin, most recently
// heard first. Station context comes from the picker's linked shows.
// ---------------------------------------------------------------------------
/** 60s in-memory cache — both endpoints below aggregate over spins and are
 *  public/unauthenticated, so identical responses are reused briefly. */
const PLAYER_AGG_TTL_MS = 60_000;
let _selectorsCache: { builtAt: number; body: unknown } | null = null;
let _scheduleCache: { builtAt: number; body: unknown } | null = null;

/** Evict the schedule read-model after an admin changes schedule evidence. */
export function clearPlayerScheduleCache(): void {
  _scheduleCache = null;
}

router.get("/player/selectors", h(async (_req, res) => {
  if (_selectorsCache && Date.now() - _selectorsCache.builtAt < PLAYER_AGG_TTL_MS) {
    return res.json(_selectorsCache.body);
  }
  type Row = {
    id: number;
    name: string;
    handle: string;
    pickerType: string;
    stationName: string | null;
    stationSlug: string | null;
    recentSpinCount: number;
    lastPlayedAt: string | null;
  };
  const rows = await db.execute<Row>(sql`
    SELECT
      p.id,
      p.name,
      p.handle,
      p.picker_type                          AS "pickerType",
      MAX(st.name)                           AS "stationName",
      MAX(st.slug)                           AS "stationSlug",
      COUNT(sp.id) FILTER (WHERE sp.played_at >= NOW() - INTERVAL '30 days')::int
                                             AS "recentSpinCount",
      MAX(sp.played_at)                      AS "lastPlayedAt"
    FROM pickers p
    JOIN shows sh
      ON sh.picker_id = p.id
      AND EXISTS (
        SELECT 1
        FROM spins sp_valid
        WHERE sp_valid.show_id = sh.id
          AND ${validScheduleShowAttribution(
            sql`sp_valid.station_id`,
            sql`sp_valid.played_at`,
            sql`sh.name`,
            sql`sh.picker_id`,
          )}
      )
    JOIN stations st ON st.id = sh.station_id AND st.hidden = false
    LEFT JOIN spins sp
      ON sp.show_id = sh.id
      AND ${validScheduleShowAttribution(
        sql`sp.station_id`,
        sql`sp.played_at`,
        sql`sh.name`,
        sql`sh.picker_id`,
      )}
    WHERE p.active = true
      AND p.picker_type = 'dj'
      AND NOT EXISTS (SELECT 1 FROM selector_claims sc WHERE sc.picker_id = p.id AND sc.opted_out = true)
    GROUP BY p.id, p.name, p.handle, p.picker_type
    HAVING MAX(sp.played_at) IS NOT NULL
    ORDER BY MAX(sp.played_at) DESC
    LIMIT 120
  `);
  const body = {
    selectors: rows.rows.map((r) => ({
      ...r,
      lastPlayedAt: r.lastPlayedAt ? new Date(r.lastPlayedAt).toISOString() : null,
    })),
  };
  _selectorsCache = { builtAt: Date.now(), body };
  return res.json(body);
}));

// ---------------------------------------------------------------------------
// GET /api/player/selectors/:handle/runs — a selector's recent runs (any DJ
// picker, not just KEXP). Includes the station slug so the run drawer can
// open directly.
// ---------------------------------------------------------------------------
router.get("/player/selectors/:handle/runs", h(async (req, res) => {
  const handle = String(req.params["handle"] ?? "").trim();
  if (!handle) return res.status(404).json({ error: "Selector not found" });

  const [picker] = await db
    .select({ id: pickersTable.id, name: pickersTable.name, handle: pickersTable.handle })
    .from(pickersTable)
    .where(and(eq(pickersTable.handle, handle), eq(pickersTable.active, true)))
    .limit(1);
  if (!picker) return res.status(404).json({ error: "Selector not found" });

  if (await isPickerOptedOut(picker.id)) {
    return res.status(404).json({ error: "Selector not found" });
  }

  type RunRow = {
    runId: number;
    day: string;
    spinCount: number;
    startedAt: string;
    showName: string | null;
    djName: string | null;
    stationSlug: string;
    stationName: string;
  };
  const runRows = await db.execute<RunRow>(sql`
    SELECT
      MIN(sp.id)::int                                AS "runId",
      (DATE(sp.played_at AT TIME ZONE 'UTC'))::text  AS day,
      COUNT(*)::int                                  AS "spinCount",
      MIN(sp.played_at)                              AS "startedAt",
      sh.name                                        AS "showName",
      sh.dj_name                                     AS "djName",
      st.slug                                        AS "stationSlug",
      st.name                                        AS "stationName"
    FROM spins sp
    JOIN shows sh
      ON sh.id = sp.show_id
      AND ${validScheduleShowAttribution(
        sql`sp.station_id`,
        sql`sp.played_at`,
        sql`sh.name`,
        sql`sh.picker_id`,
      )}
    JOIN stations st ON st.id = sh.station_id
    WHERE sh.picker_id = ${picker.id}
    GROUP BY sh.id, sh.name, sh.dj_name, st.slug, st.name,
             DATE(sp.played_at AT TIME ZONE 'UTC')
    ORDER BY MIN(sp.played_at) DESC
    LIMIT 30
  `);
  return res.json({
    selector: { name: picker.name, handle: picker.handle },
    runs: runRows.rows.map((r) => ({
      runId: r.runId,
      day: r.day,
      spinCount: r.spinCount,
      startedAt: new Date(r.startedAt).toISOString(),
      show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
      station: { slug: r.stationSlug, name: r.stationName },
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/schedule — SCHEDULE tab read-model: shows live right now
// plus the rest of today's slate, across stations with a known timezone.
// Overnight slots (end <= start) match on their start day from start_time
// onward and on the next day before end_time (yesterday-DOW carryover) —
// the same canonical pattern as the crossing scorer and the spin stamper.
// ---------------------------------------------------------------------------
router.get("/player/schedule", h(async (_req, res) => {
  if (_scheduleCache && Date.now() - _scheduleCache.builtAt < PLAYER_AGG_TTL_MS) {
    return res.json(_scheduleCache.body);
  }
  type SlotRow = {
    stationSlug: string;
    stationName: string;
    showName: string;
    djName: string | null;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    ianaTimezone: string;
    isLive: boolean;
  };
  const rows = await db.execute<SlotRow>(sql`
    SELECT
      st.slug          AS "stationSlug",
      st.name          AS "stationName",
      ss.show_name     AS "showName",
      ss.dj_name       AS "djName",
      ss.day_of_week   AS "dayOfWeek",
      ss.start_time    AS "startTime",
      ss.end_time      AS "endTime",
      st.iana_timezone AS "ianaTimezone",
      (
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND (
            (ss.end_time > ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') <  ss.end_time)
            OR
            (ss.end_time < ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time)
          ))
        OR
        (ss.end_time < ss.start_time
          AND ss.day_of_week = TO_CHAR((NOW() - interval '1 day') AT TIME ZONE st.iana_timezone, 'Dy')
          AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') < ss.end_time)
      ) AS "isLive"
    FROM scraped_shows ss
    JOIN stations st ON st.id = ss.station_id
    WHERE st.hidden = false
      AND st.active = true
      AND st.iana_timezone IS NOT NULL
      AND ss.voided_at IS NULL
      AND (
        -- live now (any DOW form above) …
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND (
            (ss.end_time > ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') <  ss.end_time)
            OR
            (ss.end_time < ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time)
          ))
        OR
        (ss.end_time < ss.start_time
          AND ss.day_of_week = TO_CHAR((NOW() - interval '1 day') AT TIME ZONE st.iana_timezone, 'Dy')
          AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') < ss.end_time)
        -- … or later today, station-local (zero-length slots excluded here too)
        OR
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND ss.start_time > TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI')
          AND ss.end_time <> ss.start_time)
      )
    ORDER BY "isLive" DESC, ss.start_time ASC, st.name ASC
    LIMIT 200
  `);
  const body = {
    liveNow: rows.rows.filter((r) => r.isLive),
    upcomingToday: rows.rows.filter((r) => !r.isLive),
  };
  _scheduleCache = { builtAt: Date.now(), body };
  return res.json(body);
}));

// ---------------------------------------------------------------------------
// Latest completed set ("Last set" scanner) — plain JSON, no orval.
//
// Runs are derived groupings of spins by (station, show, UTC day) — runId is
// the group's min(spins.id) anchor, matching the archive station-runs model.
// A run counts as COMPLETED when its last spin is older than SET_LIVE_GAP_MS:
// pollers tick every 5–15 min, so a 30-minute silence means the set ended.
// When the station's newest run is still live, the scanner falls back to the
// previous run so the listener never scans a set that is still being played.
// ---------------------------------------------------------------------------

/** A run whose last spin is newer than this is treated as still on the air. */
const SET_LIVE_GAP_MS = 30 * 60 * 1000;
/** How far back to look for a station's latest set. */
const SET_LOOKBACK_DAYS = 14;
/** Max station slugs accepted by the batch summary endpoint (one dial page). */
const LATEST_SETS_MAX_SLUGS = 20;

interface LatestSetRow {
  stationId: number;
  runId: number;
  day: string;
  showName: string | null;
  djName: string | null;
  spinCount: number;
  resolvedCount: number;
  startedAt: string;
  endedAt: string;
}

/**
 * Latest COMPLETED run group per station, keyed by station id. Stations whose
 * newest run is still live (or which have no spins in the lookback window)
 * are simply absent from the map.
 */
async function latestCompletedRuns(stationIds: number[]): Promise<Map<number, LatestSetRow>> {
  const out = new Map<number, LatestSetRow>();
  if (stationIds.length === 0) return out;
  const cutoff = new Date(Date.now() - SET_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const liveThreshold = new Date(Date.now() - SET_LIVE_GAP_MS);

  // Step 1 — pick each station's latest COMPLETED partition key (station +
  // show + UTC day). The lookback bounds SELECTION only: any spin inside the
  // window makes its whole partition eligible.
  const candidates = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      day: spinDayExpr,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
    })
    .from(spinsTable)
    .where(and(inArray(spinsTable.stationId, stationIds), gte(spinsTable.playedAt, cutoff)))
    .groupBy(spinsTable.stationId, spinsTable.showId, spinDayExpr)
    // Newest group first — per station we scan down to the first one whose
    // last spin is older than the live gap.
    .orderBy(spinsTable.stationId, desc(sql`max(${spinsTable.playedAt})`));

  const picked: { stationId: number; showId: number | null; day: string }[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    if (seen.has(c.stationId)) continue;
    if (new Date(c.endedAt) >= liveThreshold) continue; // still on the air
    seen.add(c.stationId);
    picked.push({ stationId: c.stationId, showId: c.showId, day: c.day });
  }
  if (picked.length === 0) return out;

  // Step 2 — aggregate the FULL picked partitions with no played_at bound.
  // A set that straddles the lookback boundary still reports its complete
  // tracklist, counts, and true min-id anchor, so the summary and the detail
  // endpoint (which serves the whole partition) never disagree.
  const partitionMatch = sql.join(
    picked.map((p) =>
      sql`(${spinsTable.stationId} = ${p.stationId} and ${
        p.showId == null
          ? sql`${spinsTable.showId} is null`
          : sql`${spinsTable.showId} = ${p.showId}`
      } and ${spinDayExpr} = ${p.day})`,
    ),
    sql` or `,
  );
  const rows = await db
    .select({
      stationId: spinsTable.stationId,
      runId: sql<number>`min(${spinsTable.id})`,
      day: spinDayExpr,
      showName: showsTable.name,
      djName: showsTable.djName,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
    })
    .from(spinsTable)
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(sql`(${partitionMatch})`)
    .groupBy(spinsTable.stationId, spinsTable.showId, spinDayExpr, showsTable.name, showsTable.djName);
  for (const r of rows) out.set(r.stationId, r);
  return out;
}

// GET /api/player/latest-sets?slugs=a,b,c — one summary per requested station,
// for the "Last set" affordance on expanded dial rows. Null per slug when the
// station has no completed set in the lookback window (or is unknown/hidden).
router.get("/player/latest-sets", h(async (req, res) => {
  const raw = typeof req.query.slugs === "string" ? req.query.slugs : "";
  const slugs = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))]
    .slice(0, LATEST_SETS_MAX_SLUGS);
  if (slugs.length === 0) return res.json({ items: {} });

  const stations = await db
    .select()
    .from(stationsTable)
    .where(and(inArray(stationsTable.slug, slugs), eq(stationsTable.hidden, false)));
  const runs = await latestCompletedRuns(stations.map((s) => s.id));

  const items: Record<string, unknown> = {};
  for (const slug of slugs) {
    const st = stations.find((s) => s.slug === slug);
    const run = st ? runs.get(st.id) : undefined;
    items[slug] = st && run
      ? {
          runId: run.runId,
          date: run.day,
          show: run.showName ? { name: run.showName, djName: run.djName ?? null } : null,
          spinCount: run.spinCount,
          resolvedCount: run.resolvedCount,
          startedAt: new Date(run.startedAt).toISOString(),
          endedAt: new Date(run.endedAt).toISOString(),
        }
      : null;
  }
  return res.json({ items });
}));

// GET /api/player/stations/:slug/latest-set — the full tracklist of the
// station's latest completed set, in broadcast order, for the set scanner.
// spinId is included so unresolved tracks can use the pending-keep flow.
// 404 when the station is unknown/hidden or has no completed set.
router.get("/player/stations/:slug/latest-set", h(async (req, res) => {
  const rawSlug: unknown = req.params.slug;
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) return res.status(404).json({ error: "No completed set" });

  const runs = await latestCompletedRuns([station.id]);
  const run = runs.get(station.id);
  if (!run) return res.status(404).json({ error: "No completed set" });

  // The anchor spin defines the run boundary (station + show + UTC day),
  // identical to /api/archive/station-runs/:runId.
  const [anchor] = await db
    .select({ showId: spinsTable.showId, day: spinDayExpr })
    .from(spinsTable)
    .where(eq(spinsTable.id, run.runId))
    .limit(1);
  if (!anchor) return res.status(404).json({ error: "No completed set" });

  const rows = await db
    .select({
      id: spinsTable.id,
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      confidence: spinsTable.confidence,
      mbid: recordingsTable.mbid,
      recTitle: recordingsTable.title,
      recArtist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(
      and(
        eq(spinsTable.stationId, station.id),
        anchor.showId == null
          ? isNull(spinsTable.showId)
          : eq(spinsTable.showId, anchor.showId),
        sql`${spinDayExpr} = ${anchor.day}`,
      ),
    )
    .orderBy(asc(spinsTable.playedAt), asc(spinsTable.id));
  if (!rows.length) return res.status(404).json({ error: "No completed set" });

  return res.json({
    station: { slug: station.slug, name: station.name },
    run: {
      runId: run.runId,
      date: run.day,
      show: run.showName ? { name: run.showName, djName: run.djName ?? null } : null,
      spinCount: rows.length,
      resolvedCount: rows.filter((r) => r.mbid != null).length,
      startedAt: rows[0]!.playedAt.toISOString(),
      endedAt: rows[rows.length - 1]!.playedAt.toISOString(),
    },
    tracks: rows.map((r, i) => ({
      spinId: r.id,
      position: i,
      playedAt: r.playedAt.toISOString(),
      artist: r.recArtist ?? r.rawArtist ?? "",
      title: r.recTitle ?? r.rawTitle ?? "",
      mbid: r.mbid ?? null,
      artworkUrl: r.artworkUrl ?? null,
    })),
  });
}));

export default router;
