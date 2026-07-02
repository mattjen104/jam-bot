import { Router, type IRouter } from "express";
import {
  ListStationsResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
  GetRecordingSpinsParams,
  GetRecordingSpinsResponse,
  GetRecordingSeguesParams,
  GetRecordingSeguesResponse,
  CreateManualSpinBody,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  type Station,
} from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";
import { nextSegues, spinsForRecording } from "../../lore/segue.js";
import { ingestManualSpin } from "../../lore/resolve.js";

const router: IRouter = Router();

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

    // Most recent spin for this station, joined with its resolved recording.
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
      })
      .from(spinsTable)
      .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(eq(spinsTable.stationId, station.id))
      .orderBy(desc(spinsTable.playedAt))
      .limit(1);

    const nowPlaying = row
      ? {
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
        }
      : null;

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

// GET /api/recordings/:mbid/segues
router.get("/recordings/:mbid/segues", async (req, res) => {
  const parsed = GetRecordingSeguesParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Recording not found" });
  }
  try {
    const next = await nextSegues(parsed.data.mbid);
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

export default router;
