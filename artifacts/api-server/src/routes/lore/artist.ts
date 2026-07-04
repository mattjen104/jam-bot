import { Router, type IRouter } from "express";
import { db, recordingsTable, spinsTable, stationsTable } from "@workspace/db";
import { eq, desc, sql, isNotNull } from "drizzle-orm";
import {
  getTrackById,
  cataloguePort,
  spotifyAppConfigured,
} from "../../spotify/appClient.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// GET /api/artist/:mbid
// Returns the artist name, their most-played recordings on Lore, and a Spotify
// catalogue (top tracks + albums) when Spotify is configured.
router.get("/artist/:mbid", h(async (req, res) => {
  const artistMbid = String(req.params.mbid ?? "");
  if (!artistMbid) {
    return res.status(400).json({ error: "mbid required" });
  }

  // Resolve artist name from any recording that carries this artistMbid.
  const [nameRow] = await db
    .select({ artist: recordingsTable.artist })
    .from(recordingsTable)
    .where(eq(recordingsTable.artistMbid, artistMbid))
    .limit(1);

  if (!nameRow) {
    return res.status(404).json({ error: "Artist not found" });
  }

  // Top recordings by this artist, ranked by how many times they've been spun
  // on Lore stations. Cap at 20 so the page stays scannable.
  const topTrackRows = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      spinCount: sql<number>`count(${spinsTable.id})::int`,
      lastSpunAt: sql<string>`max(${spinsTable.playedAt})`,
    })
    .from(recordingsTable)
    .innerJoin(spinsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(eq(recordingsTable.artistMbid, artistMbid))
    .groupBy(
      recordingsTable.mbid,
      recordingsTable.title,
      recordingsTable.artist,
      recordingsTable.artworkUrl,
    )
    .orderBy(desc(sql`count(${spinsTable.id})`))
    .limit(20);

  const topTracks = topTrackRows.map((r) => ({
    mbid: r.mbid,
    title: r.title,
    artist: r.artist,
    artworkUrl: r.artworkUrl ?? null,
    spinCount: r.spinCount,
    lastSpunAt: r.lastSpunAt ? new Date(r.lastSpunAt).toISOString() : null,
  }));

  // Spotify catalogue — search by artist name, then pull top tracks + albums.
  // Gracefully absent when Spotify is not configured.
  let catalogue: {
    artistId: string;
    artistName: string;
    artistUrl: string;
    topTracks: { id: string; uri: string; title: string }[];
    albums: { id: string; name: string; year?: number | null; url: string }[];
  } | null = null;

  if (spotifyAppConfigured()) {
    try {
      const artistRef = await cataloguePort.searchArtist(nameRow.artist);
      if (artistRef) {
        const [spotifyTopTracks, albums] = await Promise.all([
          cataloguePort.getArtistTopTracksList(artistRef.id),
          cataloguePort.getArtistAlbumsList(artistRef.id),
        ]);
        catalogue = {
          artistId: artistRef.id,
          artistName: artistRef.name,
          artistUrl: artistRef.url,
          topTracks: spotifyTopTracks,
          albums,
        };
      }
    } catch (err) {
      console.warn("[artist] catalogue fetch failed", artistMbid, err);
    }
  }

  return res.json({
    mbid: artistMbid,
    name: nameRow.artist,
    topTracks,
    catalogue,
  });
}));

export default router;
