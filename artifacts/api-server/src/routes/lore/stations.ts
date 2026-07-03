import { Router, type IRouter } from "express";
import {
  ListStationsResponse,
  ListStationsNowPlayingResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
  GetStationArchiveParams,
  GetStationArchiveResponse,
  GetStationPickerOverlapsParams,
  GetStationPickerOverlapsResponse,
  GetStationsRecentSpinsResponse,
  GetStationsScheduleResponse,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import { eq, ne, and, asc, desc, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl } from "../../lore/adapters.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toStation, toNowPlaying, toArchiveRecording, spinDayExpr } from "./shared.js";
import { spinRunIdExpr } from "../../lore/runs.js";

const router: IRouter = Router();

// GET /api/stations
router.get("/stations", h(async (_req, res) => {
  const rows = await db
    .select()
    .from(stationsTable)
    .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));
  return res.json(ListStationsResponse.parse({ stations: rows.map(toStation) }));
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
          stationArchiveUrl(station.nowPlayingSource, r.date) ??
          r.citation ??
          null,
        startedAt: new Date(r.startedAt).toISOString(),
        endedAt: new Date(r.endedAt).toISOString(),
      })),
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
    WHERE rn <= 8
    ORDER BY station_slug, played_at DESC
  `);

  const bySlug = new Map<string, { mbid: string | null; title: string; artist: string; playedAt: string }[]>();
  for (const row of rows.rows) {
    const spin = {
      mbid: row.mbid ?? null,
      title: row.title ?? row.raw_title ?? "",
      artist: row.artist ?? row.raw_artist ?? "",
      playedAt: new Date(row.played_at).toISOString(),
    };
    const arr = bySlug.get(row.station_slug);
    if (arr) arr.push(spin);
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

export default router;
