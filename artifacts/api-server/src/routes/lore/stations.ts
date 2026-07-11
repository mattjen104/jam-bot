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
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  pickersTable,
  picksTable,
  scrapedShowsTable,
} from "@workspace/db";
import { eq, ne, and, asc, desc, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl } from "../../lore/adapters.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toStation, toNowPlaying, toArchiveRecording, spinDayExpr } from "./shared.js";
import { spinRunIdExpr } from "../../lore/runs.js";
import { logSpinIfChanged } from "../../lore/resolve.js";
import { fingerprintStream, fingerprintAvailable } from "../../lore/stream-fingerprint.js";
import { computeGenreBreakdown, computeDiscoveryScore } from "../../lore/genre-insights.js";

const router: IRouter = Router();

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
});

// GET /api/stations
// Only active=true stations are returned — longtail candidates (active=false)
// are health-gated and must not appear in the public directory.
// `upcomingShowCount` is a denormalized column written by the schedule scraper
// in the same transaction as each scraped_shows replace, so no second query
// is needed here.
router.get("/stations", h(async (_req, res) => {
  const rows = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.active, true))
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  return res.json(ListStationsResponse.parse({
    stations: rows.map((s) => toStation(s)),
  }));
}));

// GET /api/stations/now-playing — latest spin per station (the dial pulse).
// Optional ?date=YYYY-MM-DD returns the last spin per station on that calendar
// day instead of the global latest — powers the ghost-dial date sweep.
router.get("/stations/now-playing", h(async (req, res) => {
  const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : null;
  const dateFilter = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const stations = await db
    .select({ id: stationsTable.id, slug: stationsTable.slug })
    .from(stationsTable)
    .where(eq(stationsTable.active, true))
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  const rows = await db
    .selectDistinctOn([spinsTable.stationId], {
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
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(
      dateFilter
        ? and(isNotNull(spinsTable.stationId), sql`${spinsTable.playedAt}::date = ${dateFilter}::date`)
        : isNotNull(spinsTable.stationId),
    )
    .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

  const byStation = new Map(rows.map((r) => [r.stationId, r]));
  const items = stations.map((s) => {
    const row = byStation.get(s.id);
    return { slug: s.slug, nowPlaying: row ? toNowPlaying(row) : null };
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
    .where(eq(stationsTable.slug, parsed.data.slug))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [row] = await db
    .select({
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
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(eq(spinsTable.stationId, station.id))
    .orderBy(desc(spinsTable.playedAt))
    .limit(1);

  return res.json(
    GetStationNowPlayingResponse.parse({
      station: toStation(station),
      nowPlaying: row ? toNowPlaying(row) : null,
    }),
  );
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
    .where(eq(stationsTable.slug, parsedParams.data.slug))
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

// POST /api/stations/:slug/fingerprint
// ACR absolute fallback: when neither a server poller nor Icecast metadata
// can identify the playing track, the client asks the server to grab a short
// clip from the station's own stream URL and fingerprint it via ACRCloud.
//
// The stream URL comes from the DB (not the client) — no SSRF risk. The clip
// is captured by ffmpeg, sent as bytes to ACRCloud, and the match is fed into
// logSpinIfChanged exactly like any other spin. Returns 503 when ACRCloud is
// not configured, 404 when the station doesn't exist.
router.post("/stations/:slug/fingerprint", fingerprintLimiter, h(async (req, res) => {
  if (!fingerprintAvailable()) {
    return res.status(503).json({ error: "ACR fingerprint is not configured" });
  }

  const parsedParams = ReportStationNowPlayingParams.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.slug, parsedParams.data.slug))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }
  if (!station.streamUrl) {
    return res.status(422).json({ error: "Station has no stream URL" });
  }

  let match: Awaited<ReturnType<typeof fingerprintStream>>;
  try {
    match = await fingerprintStream(station.streamUrl);
  } catch (err) {
    console.error("[lore] fingerprint failed", station.slug, err);
    return res.status(502).json({ error: "Fingerprint failed", detail: String(err) });
  }

  if (!match) {
    return res.json(IcecastReportResultBody.parse({ logged: false, mbid: null }));
  }

  const logged = await logSpinIfChanged(station, {
    rawArtist: match.artist,
    rawTitle: match.title,
    ...(match.isrc ? { isrc: match.isrc } : {}),
  });

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
    .where(eq(stationsTable.slug, parsed.data.slug))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
  }

  const runs = await db
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
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(eq(spinsTable.stationId, station.id))
    .groupBy(spinDayExpr, spinsTable.showId, showsTable.name, showsTable.djName)
    .orderBy(sql`max(${spinsTable.playedAt}) desc`)
    .limit(120);

  return res.json(
    GetStationArchiveResponse.parse({
      station: toStation(station),
      runs: runs.map((r) => ({
        runId: r.runId,
        date: r.date,
        show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
        spinCount: r.spinCount,
        resolvedCount: r.resolvedCount,
        sourceUrl:
          stationArchiveUrl(station.nowPlayingSource, r.date, station.nowPlayingConfig as Record<string, unknown> | null) ??
          r.citation ??
          null,
        startedAt: new Date(r.startedAt).toISOString(),
        endedAt: new Date(r.endedAt).toISOString(),
      })),
    }),
  );
}));

// GET /api/stations/:slug/insights — genre breakdown + discovery score across
// the station's full logged spin history. Read-time aggregation over
// already-enriched recording data; never a per-spin recompute.
router.get("/stations/:slug/insights", h(async (req, res) => {
  const parsed = GetStationInsightsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.slug, parsed.data.slug))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Station not found" });
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
      station: { slug: station.slug, name: station.name, stationClass: station.stationClass },
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
    .where(eq(stationsTable.slug, parsedQuery.data.slug))
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
    .where(eq(stationsTable.slug, parsed.data.slug))
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

// GET /api/stations/recent-spins?date=YYYY-MM-DD
// Last 8 spins per station for the given calendar day, ordered newest first.
// Uses a window function so all stations are fetched in one query.
// Powers the track-chip timeline on showless station cards (e.g. Radio Paradise).
router.get("/stations/recent-spins", h(async (req, res) => {
  const rawDate = typeof req.query.date === "string" ? req.query.date.trim() : null;
  const dateFilter = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  if (!dateFilter) {
    return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  }

  const rows = await db.execute<{
    station_slug: string;
    mbid: string | null;
    title: string | null;
    artist: string | null;
    raw_title: string | null;
    raw_artist: string | null;
    played_at: string;
  }>(sql`
    WITH ranked AS (
      SELECT
        s.slug AS station_slug,
        sp.mbid,
        r.title,
        r.artist,
        sp.raw_title,
        sp.raw_artist,
        sp.played_at,
        ROW_NUMBER() OVER (PARTITION BY sp.station_id ORDER BY sp.played_at DESC) AS rn
      FROM spins sp
      JOIN stations s ON s.id = sp.station_id
      LEFT JOIN recordings r ON r.mbid = sp.mbid
      WHERE sp.played_at::date = ${dateFilter}::date
        AND sp.station_id IS NOT NULL
    )
    SELECT station_slug, mbid, title, artist, raw_title, raw_artist, played_at
    FROM ranked
    -- Over-fetch beyond the 8 we actually want to render: some stations log
    -- the same track more than once in a row (metadata re-announces, ad-break
    -- interruptions that resume the same song, etc), so we need extra rows
    -- to still land on 8 *distinct* tracks after de-duping below.
    WHERE rn <= 30
    ORDER BY station_slug, played_at DESC
  `);

  const CHIPS_PER_STATION = 8;
  const bySlug = new Map<string, { mbid: string | null; title: string; artist: string; playedAt: string }[]>();
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

    const spin = {
      mbid: row.mbid ?? null,
      title,
      artist,
      playedAt: new Date(row.played_at).toISOString(),
    };
    if (bySlug.has(row.station_slug)) arr.push(spin);
    else bySlug.set(row.station_slug, [spin]);
  }

  const items = [...bySlug.entries()].map(([stationSlug, spins]) => ({
    stationSlug,
    spins,
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
      runId: spinRunIdExpr,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
      showName: showsTable.name,
      djName: showsTable.djName,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(
      and(
        isNotNull(spinsTable.stationId),
        sql`${spinsTable.playedAt}::date = ${dateFilter}::date`,
      ),
    )
    .groupBy(
      stationsTable.slug,
      spinDayExpr,
      spinsTable.showId,
      showsTable.name,
      showsTable.djName,
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
      show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
      spinCount: r.spinCount,
      resolvedCount: r.resolvedCount,
      startedAt: new Date(r.startedAt).toISOString(),
      endedAt: new Date(r.endedAt).toISOString(),
    })),
  }));

  return res.json(GetStationsScheduleResponse.parse({ items }));
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
    .where(eq(scrapedShowsTable.djName, djName))
    .orderBy(asc(stationsTable.name), asc(scrapedShowsTable.dayOfWeek), asc(scrapedShowsTable.startTime));

  if (rows.length === 0) {
    return res.status(404).json({ error: "DJ not found" });
  }

  return res.json({
    djName,
    shows: rows.map((r) => ({
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
    })
    .from(stationsTable)
    .where(eq(stationsTable.slug, slug))
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
    })
    .from(scrapedShowsTable)
    .where(eq(scrapedShowsTable.stationId, station[0]!.id))
    .orderBy(asc(dayRank), asc(scrapedShowsTable.startTime));

  // Freshness comes from stationsTable.scheduleScrapedAt (set on every
  // successful scrape, including a legitimate empty result) rather than from
  // row data — otherwise a station with a real, successfully-confirmed empty
  // schedule would be indistinguishable from one that's never been scraped.
  const lastScrapedAt = station[0]!.scheduleScrapedAt
    ? station[0]!.scheduleScrapedAt.toISOString()
    : null;

  return res.json(
    GetStationUpcomingScheduleResponse.parse({
      stationSlug: station[0]!.slug,
      shows: rows.map((r) => ({
        showName: r.showName,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        endTime: r.endTime,
        djName: r.djName ?? null,
      })),
      lastScrapedAt,
    }),
  );
}));

// ---------------------------------------------------------------------------
// GET /api/scraped-shows — all stations' weekly scraped show slots (for calendar)
// ---------------------------------------------------------------------------
router.get("/scraped-shows", h(async (_req, res) => {
  const rows = await db
    .select({
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      showName: scrapedShowsTable.showName,
      dayOfWeek: scrapedShowsTable.dayOfWeek,
      startTime: scrapedShowsTable.startTime,
      endTime: scrapedShowsTable.endTime,
      djName: scrapedShowsTable.djName,
    })
    .from(scrapedShowsTable)
    .innerJoin(stationsTable, eq(scrapedShowsTable.stationId, stationsTable.id))
    .orderBy(stationsTable.name, scrapedShowsTable.dayOfWeek, scrapedShowsTable.startTime);

  // Group rows by station slug
  const bySlug = new Map<string, { slug: string; name: string; shows: typeof rows }>();
  for (const row of rows) {
    if (!bySlug.has(row.stationSlug)) {
      bySlug.set(row.stationSlug, { slug: row.stationSlug, name: row.stationName, shows: [] });
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
      shows: s.shows.map((r) => ({
        showName: r.showName,
        dayOfWeek: r.dayOfWeek,
        startTime: r.startTime,
        endTime: r.endTime ?? null,
        djName: r.djName ?? null,
      })),
    })),
  });
}));

export default router;
