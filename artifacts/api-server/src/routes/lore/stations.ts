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
  stationQualityTable,
} from "@workspace/db";
import { eq, ne, and, asc, desc, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl } from "../../lore/adapters.js";
import { inferTimezone } from "../../lore/timezone.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toStation, toNowPlaying, toArchiveRecording, spinDayExpr } from "./shared.js";
import { spinRunIdExpr } from "../../lore/runs.js";
import { logSpinIfChanged, spinEvents, type SpinChangedEvent } from "../../lore/resolve.js";
import { fingerprintStream, fingerprintAvailable } from "../../lore/stream-fingerprint.js";
import { computeGenreBreakdown, computeDiscoveryScore, labelFromScore } from "../../lore/genre-insights.js";

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
// is needed here. LEFT JOINs station_quality to include qualityTier so the
// dial UI can badge or deprioritize low-quality stations.
router.get("/stations", h(async (_req, res) => {
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
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)))
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

  return res.json(ListStationsResponse.parse({
    stations: rows.map((r) => toStation(r.station, r.qualityTier)),
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
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)))
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

// GET /api/stations/now-playing/stream — Server-Sent Events push of spin
// changes. One event per persisted spin, fired the moment the resolver writes
// it (persistent ICY watchers make this near-instant for favorite stations).
// Payload carries the resolved MBID so clients need no follow-up request.
// Plain SSE, deliberately outside the OpenAPI/orval surface (EventSource, not
// fetch). Must be registered before any /stations/:slug route.
router.get("/stations/now-playing/stream", (req, res) => {
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
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  };
  spinEvents.on("spin-changed", onSpin);

  // Keep-alive comment every 30s so idle proxies don't kill the connection.
  const ping = setInterval(() => res.write(":ping\n\n"), 30_000);

  req.on("close", () => {
    clearInterval(ping);
    spinEvents.off("spin-changed", onSpin);
  });
});

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
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)))
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
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(
      and(isNotNull(spinsTable.stationId), sql`${spinsTable.playedAt}::date = ${dateFilter}::date`),
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
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      genres: recordingsTable.genres,
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
    .where(and(eq(stationsTable.slug, parsedParams.data.slug), eq(stationsTable.hidden, false)))
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
    .where(and(eq(stationsTable.slug, parsed.data.slug), eq(stationsTable.hidden, false)))
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
      JOIN stations s ON s.id = sp.station_id AND s.hidden = false
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
        eq(stationsTable.hidden, false),
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
      and(eq(scrapedShowsTable.djName, djName), eq(stationsTable.hidden, false)),
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
          genres: insight?.genres ?? [],
          discoveryScore: insight?.discoveryScore ?? null,
          discoveryLabel: insight?.discoveryLabel ?? null,
        };
      }),
    })),
  });
}));

export default router;
