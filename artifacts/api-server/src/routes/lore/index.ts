import { Router, type IRouter } from "express";
import {
  ListStationsResponse,
  GetStationNowPlayingParams,
  GetStationNowPlayingResponse,
} from "@workspace/api-zod";
import {
  db,
  stationsTable,
  spinsTable,
  recordingsTable,
  type Station,
} from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";

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

export default router;
