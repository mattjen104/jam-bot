import { Router, type IRouter, type Request, type Response } from "express";
import {
  AddSongExploderClaimBody,
  AddSongExploderClaimParams,
  ListStationsResponse,
  ListStationsNowPlayingResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
  GetRecordingKnowledgeParams,
  GetRecordingKnowledgeResponse,
  GetRecordingParams,
  GetRecordingResponse,
  GetRecordingSpinsParams,
  GetRecordingSpinsResponse,
  GetRecordingPreviewParams,
  GetRecordingPreviewResponse,
  GetRecordingSeguesParams,
  GetRecordingSeguesResponse,
  CreateManualSpinBody,
  ListPickersResponse,
  GetStationArchiveParams,
  GetStationArchiveResponse,
  GetStationRunParams,
  GetStationRunResponse,
  GetPickerArchiveParams,
  GetPickerArchiveResponse,
  GetPickerRunParams,
  GetPickerRunResponse,
  GetArchiveCoverageResponse,
  GetRecordingEntryParams,
  GetRecordingEntryResponse,
  GetRecordingLyricsParams,
  GetRecordingLyricsResponse,
  UpsertPickerBody,
  LogTracklistParams,
  LogTracklistBody,
  SeedLabelBody,
  IngestBlogBody,
  IngestDiscogsListBody,
  AddRymListBody,
  GetWikipediaDraftsParams,
  GetWikipediaDraftsResponse,
  PatchClaimParams,
  PatchClaimBody,
  ListGeniusDraftsQueryParams,
  ReviewGeniusDraftParams,
  ReviewGeniusDraftBody,
  ListGeniusDraftsResponse,
  ReviewGeniusDraftResponse,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  pickersTable,
  picksTable,
  trackClaimsTable,
  geniusAnnotationDraftsTable,
  type Station,
  type Picker,
} from "@workspace/db";
import { eq, and, asc, desc, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { nextRideable, spinsForRecording } from "../../lore/segue.js";
import { resolvePreview } from "../../lore/preview.js";
import { ingestManualSpin } from "../../lore/resolve.js";
import {
  upsertPicker,
  getPickerByHandle,
  logTracklist,
  type PickerType,
  type PickSource,
} from "../../lore/picks.js";
import { seedLabelPicker } from "../../lore/label.js";
import { addSongExploderClaim } from "../../lore/song-exploder.js";
import { ingestBlogFeed } from "../../lore/blog.js";
import { ingestDiscogsList, addRymPicker } from "../../lore/collector.js";
import { resolveEntry } from "../../lore/entry.js";
import { publishGeniusDraft, rejectGeniusDraft } from "../../lore/genius-annotations.js";
import { getLyrics } from "../../lore/lrclib.js";
import { supportsBackfill, stationArchiveUrl } from "../../lore/adapters.js";
import { enrichRecording } from "@workspace/song-enrichment";
import { wireSongEnrichment } from "../../song/wire.js";
import { fetchWikipediaClaims } from "../../lore/wikipedia.js";

wireSongEnrichment();

const router: IRouter = Router();

/**
 * Shared admin-token gate, matching the /admin/spins pattern: absent env =>
 * disabled (503), never silently open; mismatch => 401. Returns true when the
 * request may proceed (and has already been rejected otherwise). Never logs the
 * token.
 */
function requireAdmin(req: Request, res: Response): boolean {
  const adminToken = process.env["LORE_ADMIN_TOKEN"];
  if (!adminToken) {
    res.status(503).json({ error: "Admin entry is not configured" });
    return false;
  }
  const provided = req.header("x-admin-token");
  if (!provided || provided !== adminToken) {
    res.status(401).json({ error: "Invalid admin token" });
    return false;
  }
  return true;
}

/** Shape a DB picker row into the public Picker payload. */
function toPicker(p: Picker, latestRunId: number | null = null) {
  return {
    id: p.id,
    pickerType: p.pickerType,
    name: p.name,
    handle: p.handle,
    homeUrl: p.homeUrl,
    trustTier: p.trustTier,
    description: p.description,
    active: p.active,
    latestRunId,
  };
}

/** Shape a DB station row into the public Station payload. */
function toStation(s: Station) {
  return {
    slug: s.slug,
    name: s.name,
    org: s.org,
    country: s.country,
    streamUrl: s.streamUrl,
    streamQuality: s.streamQuality,
    streamFormat: s.streamFormat,
    mode: s.mode,
    homepageUrl: s.homepageUrl,
    donateUrl: s.donateUrl,
    logoUrl: s.logoUrl,
    attribution: s.attribution,
  };
}

// GET /api/stations
router.get("/stations", async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(stationsTable)
      .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));
    const data = ListStationsResponse.parse({ stations: rows.map(toStation) });
    return res.json(data);
  } catch (err) {
    console.error("[lore] list stations failed", err);
    return res.status(503).json({ error: "Could not load stations" });
  }
});

/** Shape a joined spin/recording/show row into the public NowPlaying payload. */
function toNowPlaying(row: {
  rawArtist: string | null;
  rawTitle: string | null;
  source: string | null;
  confidence: string;
  playedAt: Date;
  mbid: string | null;
  title: string | null;
  artist: string | null;
  artworkUrl: string | null;
  links: unknown;
  showName: string | null;
  showDj: string | null;
}) {
  return {
    rawArtist: row.rawArtist ?? "",
    rawTitle: row.rawTitle ?? "",
    source: row.source,
    confidence: row.confidence,
    playedAt: row.playedAt.toISOString(),
    artworkUrl: row.artworkUrl ?? null,
    recording: row.mbid
      ? {
          mbid: row.mbid,
          title: row.title ?? row.rawTitle ?? "",
          artist: row.artist ?? row.rawArtist ?? "",
          artworkUrl: row.artworkUrl ?? null,
          links: row.links ?? [],
        }
      : null,
    show: row.showName
      ? { name: row.showName, djName: row.showDj ?? null }
      : null,
  };
}

// GET /api/stations/now-playing — latest spin per station, one call (the dial pulse).
router.get("/stations/now-playing", async (_req, res) => {
  try {
    const stations = await db
      .select({ id: stationsTable.id, slug: stationsTable.slug })
      .from(stationsTable)
      .orderBy(asc(stationsTable.sortOrder), asc(stationsTable.name));

    // Latest spin per station in one pass (DISTINCT ON), joined to its
    // resolved recording (artwork) and show/DJ attribution.
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
      .where(isNotNull(spinsTable.stationId))
      .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

    const byStation = new Map(rows.map((r) => [r.stationId, r]));
    const items = stations.map((s) => {
      const row = byStation.get(s.id);
      return { slug: s.slug, nowPlaying: row ? toNowPlaying(row) : null };
    });

    const data = ListStationsNowPlayingResponse.parse({ items });
    return res.json(data);
  } catch (err) {
    console.error("[lore] bulk now-playing failed", err);
    return res.status(503).json({ error: "Could not load now-playing" });
  }
});

// GET /api/stations/:slug/now-playing
router.get("/stations/:slug/now-playing", async (req, res) => {
  const parsed = GetStationNowPlayingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }
  try {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, parsed.data.slug))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    // Most recent spin for this station, joined with its resolved recording
    // and show/DJ attribution.
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

    const nowPlaying = row ? toNowPlaying(row) : null;

    const data = GetStationNowPlayingResponse.parse({
      station: toStation(station),
      nowPlaying,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] now-playing failed", err);
    return res.status(503).json({ error: "Could not load now-playing" });
  }
});

// GET /api/recordings/:mbid — the recording's own metadata (song-page header).
router.get("/recordings/:mbid", async (req, res) => {
  const parsed = GetRecordingParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const [rec] = await db
      .select({
        mbid: recordingsTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        artistMbid: recordingsTable.artistMbid,
        durationMs: recordingsTable.durationMs,
        artworkUrl: recordingsTable.artworkUrl,
        links: recordingsTable.links,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    if (!rec) {
      return res.status(404).json({ error: "Recording not found" });
    }
    const data = GetRecordingResponse.parse({
      mbid: rec.mbid,
      title: rec.title,
      artist: rec.artist,
      artistMbid: rec.artistMbid,
      durationMs: rec.durationMs,
      artworkUrl: rec.artworkUrl ?? null,
      links: rec.links ?? [],
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] get recording failed", err);
    return res.status(503).json({ error: "Could not load recording" });
  }
});

// GET /api/recordings/:mbid/knowledge — liner-notes credits/pressing for the
// live player. Enrichment runs off the hot path and caches by recording id;
// `knowledge` is null when sources are unconfigured or nothing verifiable
// resolved — Lore never fabricates credits.
router.get("/recordings/:mbid/knowledge", async (req, res) => {
  const parsed = GetRecordingKnowledgeParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const [rec] = await db
      .select()
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    if (!rec) {
      return res.status(404).json({ error: "Recording not found" });
    }

    const knowledge = await enrichRecording({
      recordingId: rec.mbid,
      title: rec.title,
      artist: rec.artist,
      isrc: rec.isrc,
    });

    const claimRows = await db
      .select()
      .from(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.mbid, rec.mbid),
          eq(trackClaimsTable.status, "published"),
        ),
      )
      .orderBy(trackClaimsTable.id);

    // Fire-and-forget Wikipedia check — off the hot path, idempotent.
    fetchWikipediaClaims(rec.mbid).catch((err) =>
      console.warn("[lore] wikipedia fire-and-forget failed", rec.mbid, err),
    );

    const data = GetRecordingKnowledgeResponse.parse({
      knowledge: knowledge ?? null,
      claims: claimRows.map((c) => ({
        id: c.id,
        text: c.text,
        sourceLabel: c.sourceLabel,
        sourceUrl: c.sourceUrl,
        sourceHandle: c.sourceHandle,
        positionMs: c.positionMs,
        anchorType: c.anchorType ?? null,
        anchorValue: c.anchorValue ?? null,
        status: c.status,
        verified: c.verified,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording knowledge failed", err);
    return res.status(503).json({ error: "Could not load liner notes" });
  }
});

// GET /api/recordings/:mbid/lyrics — synced lyric lines from LRCLIB
router.get("/recordings/:mbid/lyrics", async (req, res) => {
  const parsed = GetRecordingLyricsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const [rec] = await db
      .select({ mbid: recordingsTable.mbid })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    if (!rec) return res.status(404).json({ error: "Recording not found" });

    const lines = await getLyrics(rec.mbid);
    return res.json(GetRecordingLyricsResponse.parse({ lines }));
  } catch (err) {
    console.error("[lore] recording lyrics failed", err);
    return res.status(503).json({ error: "Could not load lyrics" });
  }
});

// GET /api/recordings/:mbid/spins
router.get("/recordings/:mbid/spins", async (req, res) => {
  const parsed = GetRecordingSpinsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const spins = await spinsForRecording(parsed.data.mbid);
    const data = GetRecordingSpinsResponse.parse({
      mbid: parsed.data.mbid,
      spins: spins.map((s) => ({
        playedAt: s.playedAt.toISOString(),
        source: s.source,
        confidence: s.confidence,
        station: s.station,
        show: s.show,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording spins failed", err);
    return res.status(503).json({ error: "Could not load spins" });
  }
});

// GET /api/recordings/:mbid/preview — best-effort 30s clip (for riding).
router.get("/recordings/:mbid/preview", async (req, res) => {
  const parsed = GetRecordingPreviewParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const [rec] = await db
      .select({
        title: recordingsTable.title,
        artist: recordingsTable.artist,
      })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    if (!rec) {
      return res.status(404).json({ error: "Recording not found" });
    }
    const preview = await resolvePreview(parsed.data.mbid, rec.artist, rec.title);
    const data = GetRecordingPreviewResponse.parse({
      mbid: parsed.data.mbid,
      previewUrl: preview.previewUrl,
      artworkUrl: preview.artworkUrl,
      source: preview.source,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording preview failed", err);
    return res.status(503).json({ error: "Could not load preview" });
  }
});

// GET /api/recordings/:mbid/segues
router.get("/recordings/:mbid/segues", async (req, res) => {
  const parsed = GetRecordingSeguesParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const next = await nextRideable(parsed.data.mbid);
    const data = GetRecordingSeguesResponse.parse({
      mbid: parsed.data.mbid,
      next,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording segues failed", err);
    return res.status(503).json({ error: "Could not load segues" });
  }
});

// POST /api/admin/spins — admin-only manual/historical spin entry.
router.post("/admin/spins", async (req, res) => {
  // Gate on a server-side token. Absent env => the endpoint is disabled (503),
  // never silently open. Never log the token.
  const adminToken = process.env["LORE_ADMIN_TOKEN"];
  if (!adminToken) {
    return res.status(503).json({ error: "Manual entry is not configured" });
  }
  const provided = req.header("x-admin-token");
  if (!provided || provided !== adminToken) {
    return res.status(401).json({ error: "Invalid admin token" });
  }

  const parsed = CreateManualSpinBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid manual spin" });
  }
  const body = parsed.data;

  try {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, body.stationSlug))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    const playedAt = body.playedAt ? new Date(body.playedAt) : new Date();
    if (Number.isNaN(playedAt.getTime())) {
      return res.status(400).json({ error: "Invalid playedAt timestamp" });
    }

    const { logged, resolution } = await ingestManualSpin({
      station,
      artist: body.artist,
      title: body.title,
      citation: body.citation,
      playedAt,
      ...(body.showName
        ? {
            show: {
              name: body.showName,
              ...(body.djName ? { djName: body.djName } : {}),
            },
          }
        : {}),
      ...(body.durationMs != null ? { durationMs: body.durationMs } : {}),
    });

    return res.status(201).json({
      logged,
      mbid: resolution.mbid,
      confidence: resolution.confidence,
    });
  } catch (err) {
    console.error("[lore] manual spin failed", err);
    const message =
      err instanceof Error ? err.message : "Could not log manual spin";
    return res.status(400).json({ error: message });
  }
});

// GET /api/pickers — public list of taste sources beyond radio DJs.
// Optional ?type= filter narrows to a specific pickerType (e.g. "editorial").
router.get("/pickers", async (req, res) => {
  try {
    const typeFilter = typeof req.query["type"] === "string"
      ? req.query["type"].trim()
      : null;
    const rows = await db
      .select()
      .from(pickersTable)
      .where(
        typeFilter
          ? and(eq(pickersTable.active, true), eq(pickersTable.pickerType, typeFilter))
          : eq(pickersTable.active, true),
      )
      .orderBy(asc(pickersTable.trustTier), asc(pickersTable.name));

    // Resolve the latest runId per picker (min pick.id of the most-recently-ingested sourceUrl).
    const latestRunById = new Map<number, number>();
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      // Group by (picker_id, source_url) to get one row per run; find the
      // freshest run per picker in JS rather than fighting SQL ordering.
      const runRows = await db
        .select({
          pickerId: picksTable.pickerId,
          latestAt: sql<Date>`max(${picksTable.pickedAt})`,
          runId: sql<number>`min(${picksTable.id})`,
        })
        .from(picksTable)
        .where(and(inArray(picksTable.pickerId, ids), isNotNull(picksTable.sourceUrl)))
        .groupBy(picksTable.pickerId, picksTable.sourceUrl);

      const latestAtByPicker = new Map<number, Date>();
      for (const r of runRows) {
        if (r.pickerId == null || r.latestAt == null) continue;
        const prev = latestAtByPicker.get(r.pickerId);
        if (!prev || r.latestAt > prev) {
          latestAtByPicker.set(r.pickerId, r.latestAt);
          latestRunById.set(r.pickerId, r.runId);
        }
      }
    }

    const data = ListPickersResponse.parse({
      pickers: rows.map((r) => toPicker(r, latestRunById.get(r.id) ?? null)),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] list pickers failed", err instanceof Error ? err.message : String(err));
    return res.status(503).json({ error: "Could not load pickers" });
  }
});

/** UTC broadcast day of a spin, as YYYY-MM-DD (the run grouping key). */
const spinDayExpr = sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;

/** Shape a joined recording row into a NowPlayingRecording payload, or null. */
function toArchiveRecording(row: {
  mbid: string | null;
  recTitle: string | null;
  recArtist: string | null;
  artworkUrl: string | null;
  links: unknown;
}) {
  return row.mbid
    ? {
        mbid: row.mbid,
        title: row.recTitle ?? "",
        artist: row.recArtist ?? "",
        artworkUrl: row.artworkUrl ?? null,
        links: row.links ?? [],
      }
    : null;
}

// GET /api/stations/:slug/archive — a station's documented runs, newest first.
router.get("/stations/:slug/archive", async (req, res) => {
  const parsed = GetStationArchiveParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Station not found" });
  }
  try {
    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.slug, parsed.data.slug))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Station not found" });
    }

    // One run per (show, UTC broadcast day). runId = the run's smallest spin
    // id — opaque, stable, and enough to reconstruct the group on detail read.
    const runs = await db
      .select({
        runId: sql<number>`min(${spinsTable.id})`,
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

    const data = GetStationArchiveResponse.parse({
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
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] station archive failed", err);
    return res.status(503).json({ error: "Could not load archive" });
  }
});

// GET /api/archive/station-runs/:runId — one run's tracklist, as it aired.
router.get("/archive/station-runs/:runId", async (req, res) => {
  const parsed = GetStationRunParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }
  try {
    // The anchor spin defines the run: its station + show + UTC broadcast day.
    const [anchor] = await db
      .select({
        stationId: spinsTable.stationId,
        showId: spinsTable.showId,
        day: spinDayExpr,
      })
      .from(spinsTable)
      .where(eq(spinsTable.id, parsed.data.runId))
      .limit(1);
    if (!anchor) {
      return res.status(404).json({ error: "Run not found" });
    }

    const [station] = await db
      .select()
      .from(stationsTable)
      .where(eq(stationsTable.id, anchor.stationId))
      .limit(1);
    if (!station) {
      return res.status(404).json({ error: "Run not found" });
    }

    const rows = await db
      .select({
        id: spinsTable.id,
        playedAt: spinsTable.playedAt,
        rawArtist: spinsTable.rawArtist,
        rawTitle: spinsTable.rawTitle,
        confidence: spinsTable.confidence,
        citation: spinsTable.citation,
        mbid: recordingsTable.mbid,
        recTitle: recordingsTable.title,
        recArtist: recordingsTable.artist,
        artworkUrl: recordingsTable.artworkUrl,
        links: recordingsTable.links,
        showName: showsTable.name,
        djName: showsTable.djName,
      })
      .from(spinsTable)
      .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
      .where(
        and(
          eq(spinsTable.stationId, anchor.stationId),
          anchor.showId == null
            ? isNull(spinsTable.showId)
            : eq(spinsTable.showId, anchor.showId),
          sql`${spinDayExpr} = ${anchor.day}`,
        ),
      )
      .orderBy(asc(spinsTable.playedAt), asc(spinsTable.id));
    if (!rows.length) {
      return res.status(404).json({ error: "Run not found" });
    }

    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const data = GetStationRunResponse.parse({
      station: {
        slug: station.slug,
        name: station.name,
        stationClass: station.stationClass,
      },
      run: {
        runId: parsed.data.runId,
        date: anchor.day,
        show: first.showName
          ? { name: first.showName, djName: first.djName ?? null }
          : null,
        spinCount: rows.length,
        resolvedCount: rows.filter((r) => r.mbid != null).length,
        sourceUrl:
          stationArchiveUrl(station.nowPlayingSource, anchor.day) ??
          rows.map((r) => r.citation).find((c) => c != null) ??
          null,
        startedAt: first.playedAt.toISOString(),
        endedAt: last.playedAt.toISOString(),
      },
      tracks: rows.map((r, i) => ({
        position: i,
        playedAt: r.playedAt.toISOString(),
        rawArtist: r.rawArtist ?? "",
        rawTitle: r.rawTitle ?? "",
        confidence: r.confidence,
        recording: toArchiveRecording(r),
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] station run failed", err);
    return res.status(503).json({ error: "Could not load run" });
  }
});

// GET /api/pickers/:handle/archive — a picker's documented runs, newest first.
router.get("/pickers/:handle/archive", async (req, res) => {
  const parsed = GetPickerArchiveParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Picker not found" });
  }
  try {
    const picker = await getPickerByHandle(parsed.data.handle);
    if (!picker) {
      return res.status(404).json({ error: "Picker not found" });
    }

    // One run per source URL (an NTS episode page, a list, a post).
    const runs = await db
      .select({
        runId: sql<number>`min(${picksTable.id})`,
        sourceUrl: picksTable.sourceUrl,
        title: sql<string | null>`max(${picksTable.context})`,
        pickedAt: sql<string | null>`min(${picksTable.pickedAt})`,
        trackCount: sql<number>`count(*)::int`,
        resolvedCount: sql<number>`count(*) filter (where ${picksTable.mbid} is not null)::int`,
      })
      .from(picksTable)
      .where(
        and(eq(picksTable.pickerId, picker.id), isNotNull(picksTable.sourceUrl)),
      )
      .groupBy(picksTable.sourceUrl)
      .orderBy(
        sql`min(${picksTable.pickedAt}) desc nulls last`,
        sql`min(${picksTable.id}) desc`,
      )
      .limit(200);

    const data = GetPickerArchiveResponse.parse({
      picker: toPicker(picker),
      runs: runs.map((r) => ({
        runId: r.runId,
        title: r.title ?? null,
        sourceUrl: r.sourceUrl as string,
        pickedAt: r.pickedAt ? new Date(r.pickedAt).toISOString() : null,
        trackCount: r.trackCount,
        resolvedCount: r.resolvedCount,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] picker archive failed", err);
    return res.status(503).json({ error: "Could not load archive" });
  }
});

// GET /api/archive/picker-runs/:runId — one run's picks, in documented order.
router.get("/archive/picker-runs/:runId", async (req, res) => {
  const parsed = GetPickerRunParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }
  try {
    // The anchor pick defines the run: its picker + source URL.
    const [anchor] = await db
      .select({
        pickerId: picksTable.pickerId,
        sourceUrl: picksTable.sourceUrl,
      })
      .from(picksTable)
      .where(eq(picksTable.id, parsed.data.runId))
      .limit(1);
    if (!anchor || !anchor.sourceUrl) {
      return res.status(404).json({ error: "Run not found" });
    }

    const [picker] = await db
      .select()
      .from(pickersTable)
      .where(eq(pickersTable.id, anchor.pickerId))
      .limit(1);
    if (!picker) {
      return res.status(404).json({ error: "Run not found" });
    }

    const rows = await db
      .select({
        id: picksTable.id,
        ordinal: picksTable.ordinal,
        pickedAt: picksTable.pickedAt,
        context: picksTable.context,
        rawArtist: picksTable.rawArtist,
        rawTitle: picksTable.rawTitle,
        confidence: picksTable.confidence,
        mbid: recordingsTable.mbid,
        recTitle: recordingsTable.title,
        recArtist: recordingsTable.artist,
        artworkUrl: recordingsTable.artworkUrl,
        links: recordingsTable.links,
      })
      .from(picksTable)
      .leftJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(picksTable.pickerId, anchor.pickerId),
          eq(picksTable.sourceUrl, anchor.sourceUrl),
        ),
      )
      .orderBy(
        sql`${picksTable.ordinal} asc nulls last`,
        asc(picksTable.id),
      );
    if (!rows.length) {
      return res.status(404).json({ error: "Run not found" });
    }

    const pickedAt =
      rows.map((r) => r.pickedAt).find((d) => d != null) ?? null;
    const data = GetPickerRunResponse.parse({
      picker: toPicker(picker),
      run: {
        runId: parsed.data.runId,
        title: rows[0]!.context ?? null,
        sourceUrl: anchor.sourceUrl,
        pickedAt: pickedAt ? pickedAt.toISOString() : null,
        trackCount: rows.length,
        resolvedCount: rows.filter((r) => r.mbid != null).length,
      },
      tracks: rows.map((r, i) => ({
        position: r.ordinal ?? i,
        playedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
        rawArtist: r.rawArtist ?? "",
        rawTitle: r.rawTitle ?? "",
        confidence: r.confidence,
        recording: toArchiveRecording(r),
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] picker run failed", err instanceof Error ? err.message : String(err));
    return res.status(503).json({ error: "Could not load run" });
  }
});

// GET /api/archive/coverage — how deep the archive goes, per source. This is
// the observability surface the spec asks for: "how good is ghost radio" must
// be answerable at a glance (depth reached, backfill progress, resolution rate).
router.get("/archive/coverage", async (_req, res) => {
  try {
    const stationRows = await db
      .select({
        slug: stationsTable.slug,
        name: stationsTable.name,
        source: stationsTable.nowPlayingSource,
        backfillDone: stationsTable.backfillDone,
        backfillCursor: stationsTable.backfillCursor,
        spinCount: sql<number>`count(${spinsTable.id})::int`,
        resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
        oldestSpinAt: sql<string | null>`min(${spinsTable.playedAt})`,
        newestSpinAt: sql<string | null>`max(${spinsTable.playedAt})`,
      })
      .from(stationsTable)
      .leftJoin(spinsTable, eq(spinsTable.stationId, stationsTable.id))
      .groupBy(
        stationsTable.id,
        stationsTable.slug,
        stationsTable.name,
        stationsTable.nowPlayingSource,
        stationsTable.backfillDone,
        stationsTable.backfillCursor,
      )
      .orderBy(sql`count(${spinsTable.id}) desc`);

    const pickerRows = await db
      .select({
        handle: pickersTable.handle,
        name: pickersTable.name,
        runCount: sql<number>`count(distinct ${picksTable.sourceUrl}) filter (where ${picksTable.sourceUrl} is not null)::int`,
        pickCount: sql<number>`count(${picksTable.id})::int`,
        resolvedCount: sql<number>`count(*) filter (where ${picksTable.mbid} is not null)::int`,
        oldestPickedAt: sql<string | null>`min(${picksTable.pickedAt})`,
        newestPickedAt: sql<string | null>`max(${picksTable.pickedAt})`,
      })
      .from(pickersTable)
      .innerJoin(picksTable, eq(picksTable.pickerId, pickersTable.id))
      .groupBy(pickersTable.id, pickersTable.handle, pickersTable.name)
      .orderBy(sql`count(${picksTable.id}) desc`);

    const data = GetArchiveCoverageResponse.parse({
      stations: stationRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        spinCount: r.spinCount,
        resolvedCount: r.resolvedCount,
        oldestSpinAt: r.oldestSpinAt
          ? new Date(r.oldestSpinAt).toISOString()
          : null,
        newestSpinAt: r.newestSpinAt
          ? new Date(r.newestSpinAt).toISOString()
          : null,
        supportsBackfill: supportsBackfill(r.source),
        backfillDone: r.backfillDone,
        backfillCursor: r.backfillCursor ?? null,
      })),
      pickers: pickerRows.map((r) => ({
        handle: r.handle,
        name: r.name,
        runCount: r.runCount,
        pickCount: r.pickCount,
        resolvedCount: r.resolvedCount,
        oldestPickedAt: r.oldestPickedAt
          ? new Date(r.oldestPickedAt).toISOString()
          : null,
        newestPickedAt: r.newestPickedAt
          ? new Date(r.newestPickedAt).toISOString()
          : null,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] archive coverage failed", err);
    return res.status(503).json({ error: "Could not load coverage" });
  }
});

// GET /api/recordings/:mbid/entry — the source-agnostic fallback ladder.
router.get("/recordings/:mbid/entry", async (req, res) => {
  const parsed = GetRecordingEntryParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    // The artist-level rung needs the recording's artist MBID; resolve it from
    // the spine so the ladder needs no client-supplied hint.
    const [rec] = await db
      .select({ artistMbid: recordingsTable.artistMbid })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, parsed.data.mbid))
      .limit(1);
    const result = await resolveEntry(
      parsed.data.mbid,
      rec?.artistMbid ?? undefined,
    );
    const data = GetRecordingEntryResponse.parse(result);
    return res.json(data);
  } catch (err) {
    console.error("[lore] recording entry failed", err);
    return res.status(503).json({ error: "Could not load entry" });
  }
});

// POST /api/admin/pickers — admin-only create/update of a picker.
router.post("/admin/pickers", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpsertPickerBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid picker" });
  }
  const b = parsed.data;
  try {
    const picker = await upsertPicker({
      pickerType: b.pickerType as PickerType,
      name: b.name,
      ...(b.handle ? { handle: b.handle } : {}),
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
      ...(b.trustTier != null ? { trustTier: b.trustTier } : {}),
      ...(b.description ? { description: b.description } : {}),
    });
    return res.status(201).json(toPicker(picker));
  } catch (err) {
    console.error("[lore] upsert picker failed", err);
    const message = err instanceof Error ? err.message : "Could not save picker";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/pickers/:handle/picks — admin-only tracklist ingest.
router.post("/admin/pickers/:handle/picks", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = LogTracklistParams.safeParse(req.params);
  if (!params.success) {
    return res.status(404).json({ error: "Picker not found" });
  }
  const parsed = LogTracklistBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tracklist" });
  }
  try {
    const picker = await getPickerByHandle(params.data.handle);
    if (!picker) {
      return res.status(404).json({ error: "Picker not found" });
    }
    const b = parsed.data;
    const summary = await logTracklist({
      pickerId: picker.id,
      source: b.source as PickSource,
      entries: b.entries,
      ...(b.ordered != null ? { ordered: b.ordered } : {}),
      ...(b.sourceUrl ? { sourceUrl: b.sourceUrl } : {}),
      ...(b.context ? { context: b.context } : {}),
    });
    return res.status(201).json(summary);
  } catch (err) {
    console.error("[lore] log tracklist failed", err);
    return res.status(400).json({ error: "Could not log tracklist" });
  }
});

// POST /api/admin/labels — admin-only label seed by MusicBrainz MBID.
router.post("/admin/labels", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = SeedLabelBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid label seed" });
  }
  const b = parsed.data;
  try {
    const summary = await seedLabelPicker({
      labelMbid: b.labelMbid,
      ...(b.name ? { name: b.name } : {}),
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
    });
    return res.status(201).json({ ...summary, matched: null });
  } catch (err) {
    console.error("[lore] seed label failed", err);
    const message = err instanceof Error ? err.message : "Could not seed label";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/blogs — admin-only blog/critic RSS ingest.
router.post("/admin/blogs", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = IngestBlogBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid blog ingest" });
  }
  const b = parsed.data;
  try {
    const r = await ingestBlogFeed({
      feedUrl: b.feedUrl,
      name: b.name,
      ...(b.homeUrl ? { homeUrl: b.homeUrl } : {}),
    });
    return res.status(201).json({
      pickerId: r.pickerId,
      handle: r.handle,
      name: r.name,
      found: r.items,
      matched: r.matched,
      logged: r.logged,
    });
  } catch (err) {
    console.error("[lore] ingest blog failed", err);
    const message = err instanceof Error ? err.message : "Could not ingest blog";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/discogs-lists — admin-only Discogs list ingest (collector).
router.post("/admin/discogs-lists", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = IngestDiscogsListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Discogs list ingest" });
  }
  const b = parsed.data;
  try {
    const r = await ingestDiscogsList({
      listId: b.listId,
      ...(b.name ? { name: b.name } : {}),
    });
    return res.status(201).json({
      pickerId: r.pickerId,
      handle: r.handle,
      name: r.name,
      found: r.items,
      matched: null,
      logged: r.logged,
    });
  } catch (err) {
    console.error("[lore] ingest discogs list failed", err);
    const message =
      err instanceof Error ? err.message : "Could not ingest Discogs list";
    return res.status(400).json({ error: message });
  }
});

// POST /api/admin/song-exploder/:episodeId/claims — attach a timestamp-anchored
// claim to the recording resolved from a Song Exploder episode.
router.post("/admin/song-exploder/:episodeId/claims", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = AddSongExploderClaimParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid episode id" });
  }
  const parsed = AddSongExploderClaimBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid claim body" });
  }
  const b = parsed.data;
  try {
    const result = await addSongExploderClaim({
      episodeId: params.data.episodeId,
      offsetMs: b.offsetMs ?? null,
      text: b.text,
      sourceUrl: b.sourceUrl,
    });
    return res.status(201).json(result);
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) {
      return res.status(404).json({ error: "Episode not found" });
    }
    if (status === 409) {
      return res.status(409).json({
        error: "Episode not yet resolved to a recording — resolve it first",
      });
    }
    console.error("[lore] song-exploder claim failed", err);
    return res.status(400).json({ error: "Could not store claim" });
  }
});

// GET /api/admin/wikipedia-drafts?mbid= — draft Wikipedia claims pending review.
router.get("/admin/wikipedia-drafts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = GetWikipediaDraftsParams.safeParse({ mbid: req.query["mbid"] });
  if (!parsed.success) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }
  try {
    const rows = await db
      .select()
      .from(trackClaimsTable)
      .where(
        and(
          eq(trackClaimsTable.mbid, parsed.data.mbid),
          eq(trackClaimsTable.sourceHandle, "wikipedia"),
          eq(trackClaimsTable.status, "draft"),
        ),
      )
      .orderBy(trackClaimsTable.id);

    const data = GetWikipediaDraftsResponse.parse({
      claims: rows.map((c) => ({
        id: c.id,
        mbid: c.mbid,
        anchorValue: c.anchorValue ?? "",
        sourceLabel: c.sourceLabel,
        sourceUrl: c.sourceUrl,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] wikipedia drafts failed", err);
    return res.status(503).json({ error: "Could not load drafts" });
  }
});

// PATCH /api/admin/claims/:id — admin review: paraphrase + publish or reject.
router.patch("/admin/claims/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = PatchClaimParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid claim id" });
  }
  const body = PatchClaimBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const b = body.data;

  // When publishing, text is required (the admin-written paraphrase).
  if (b.status === "published" && (!b.text || !b.text.trim())) {
    return res
      .status(400)
      .json({ error: "text is required when publishing a claim" });
  }

  try {
    const [existing] = await db
      .select()
      .from(trackClaimsTable)
      .where(eq(trackClaimsTable.id, params.data.id))
      .limit(1);
    if (!existing) {
      return res.status(404).json({ error: "Claim not found" });
    }

    const [updated] = await db
      .update(trackClaimsTable)
      .set({
        status: b.status,
        ...(b.text ? { text: b.text.trim() } : {}),
      })
      .where(eq(trackClaimsTable.id, params.data.id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Claim not found" });
    }

    return res.json({
      id: updated.id,
      mbid: updated.mbid,
      anchorValue: updated.anchorValue ?? "",
      sourceLabel: updated.sourceLabel,
      sourceUrl: updated.sourceUrl,
      status: updated.status,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[lore] patch claim failed", err);
    return res.status(503).json({ error: "Could not update claim" });
  }
});

// GET /api/admin/genius-drafts?mbid=:mbid — list pending annotation drafts.
router.get("/admin/genius-drafts", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = ListGeniusDraftsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "mbid query parameter is required" });
  }
  try {
    const rows = await db
      .select()
      .from(geniusAnnotationDraftsTable)
      .where(
        and(
          eq(geniusAnnotationDraftsTable.mbid, parsed.data.mbid),
          eq(geniusAnnotationDraftsTable.status, "draft"),
        ),
      )
      .orderBy(
        desc(geniusAnnotationDraftsTable.verified),
        desc(geniusAnnotationDraftsTable.voteCount),
        asc(geniusAnnotationDraftsTable.id),
      );
    const data = ListGeniusDraftsResponse.parse({
      mbid: parsed.data.mbid,
      drafts: rows.map((r) => ({
        id: r.id,
        mbid: r.mbid,
        geniusSongId: r.geniusSongId,
        geniusAnnotationId: r.geniusAnnotationId,
        fragment: r.fragment,
        anchorType: r.anchorType,
        offsetMs: r.offsetMs ?? null,
        geniusUrl: r.geniusUrl,
        verified: r.verified,
        voteCount: r.voteCount,
        status: r.status,
      })),
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] list genius drafts failed", err);
    return res.status(503).json({ error: "Could not load genius drafts" });
  }
});

// POST /api/admin/genius-drafts/:id/review — publish or reject a draft.
router.post("/admin/genius-drafts/:id/review", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const params = ReviewGeniusDraftParams.safeParse(req.params);
  if (!params.success) {
    return res.status(400).json({ error: "Invalid draft id" });
  }
  const parsed = ReviewGeniusDraftBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid review request" });
  }
  const { action, text } = parsed.data;
  if (action === "publish" && !text) {
    return res
      .status(400)
      .json({ error: "text (paraphrase) is required when publishing" });
  }
  try {
    if (action === "reject") {
      const ok = await rejectGeniusDraft(params.data.id);
      if (!ok) return res.status(404).json({ error: "Draft not found" });
      const data = ReviewGeniusDraftResponse.parse({
        id: params.data.id,
        action: "rejected",
        claimId: null,
      });
      return res.json(data);
    }
    // action === "publish"
    const claimId = await publishGeniusDraft(params.data.id, text!);
    if (claimId === null) {
      return res
        .status(400)
        .json({ error: "Draft not found or not in reviewable state" });
    }
    const data = ReviewGeniusDraftResponse.parse({
      id: params.data.id,
      action: "published",
      claimId,
    });
    return res.json(data);
  } catch (err) {
    console.error("[lore] review genius draft failed", err);
    return res.status(503).json({ error: "Could not review genius draft" });
  }
});

// POST /api/admin/rym-lists — admin-only RateYourMusic link-out picker.
router.post("/admin/rym-lists", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = AddRymListBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid RYM list" });
  }
  const b = parsed.data;
  try {
    const r = await addRymPicker({ name: b.name, url: b.url });
    const picker = await getPickerByHandle(r.handle);
    if (!picker) {
      return res.status(400).json({ error: "Could not create RYM picker" });
    }
    return res.status(201).json(toPicker(picker));
  } catch (err) {
    console.error("[lore] add rym list failed", err);
    const message = err instanceof Error ? err.message : "Could not add RYM list";
    return res.status(400).json({ error: message });
  }
});

export default router;
