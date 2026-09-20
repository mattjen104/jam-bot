import { Router, type IRouter } from "express";
import { db, recordingsTable, recordingCreditsTable, recordingReleaseGroupsTable, spinsTable } from "@workspace/db";
import { and, asc, eq, desc, sql } from "drizzle-orm";
import {
  cataloguePort,
  spotifyAppConfigured,
} from "../../spotify/appClient.js";
import { h } from "../../middlewares/asyncHandler.js";
import { getArtistWikidataMetadata } from "../../lore/artist-wikidata.js";

const router: IRouter = Router();

// GET /api/artist/:mbid/metadata
// Separate from the artist page so provider/cache failures never take down the
// existing Lore discography surface.
router.get("/artist/:mbid/metadata", h(async (req, res) => {
  const artistMbid = String(req.params.mbid ?? "").trim();
  if (!artistMbid) return res.status(400).json({ error: "mbid required" });
  return res.json(await getArtistWikidataMetadata(artistMbid));
}));

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

  const [creditNameRow] = await db
    .select({ creditedName: recordingCreditsTable.creditedName })
    .from(recordingCreditsTable)
    .where(eq(recordingCreditsTable.artistMbid, artistMbid))
    .limit(1);
  if (!nameRow && !creditNameRow) {
    return res.status(404).json({ error: "Artist not found" });
  }
  const artistName = nameRow?.artist ?? creditNameRow!.creditedName;

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

  const albumRows = await db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      title: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
      primaryType: recordingReleaseGroupsTable.primaryType,
      firstRecordingMbid: sql<string>`min(${recordingsTable.mbid})`,
      artworkUrl: sql<string | null>`max(${recordingsTable.artworkUrl})`,
      trackCount: sql<number>`count(distinct ${recordingsTable.mbid})::int`,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      recordingsTable,
      eq(recordingsTable.mbid, recordingReleaseGroupsTable.recordingMbid),
    )
    .where(and(
      eq(recordingsTable.artistMbid, artistMbid),
      eq(recordingReleaseGroupsTable.isPrimary, true),
    ))
    .groupBy(
      recordingReleaseGroupsTable.releaseGroupMbid,
      recordingReleaseGroupsTable.title,
      recordingReleaseGroupsTable.releaseYear,
      recordingReleaseGroupsTable.primaryType,
    )
    .orderBy(desc(recordingReleaseGroupsTable.releaseYear), recordingReleaseGroupsTable.title);

  const albums = albumRows
    .filter((row) => row.title != null)
    .map((row) => ({
      releaseGroupMbid: row.releaseGroupMbid,
      title: row.title!,
      releaseYear: row.releaseYear ?? null,
      primaryType: row.primaryType ?? null,
      artworkUrl: row.artworkUrl ?? null,
      firstRecordingMbid: row.firstRecordingMbid,
      trackCount: row.trackCount,
    }));

  const creditedRows = await db
    .select({
      recordingMbid: recordingCreditsTable.recordingMbid,
      trackTitle: recordingsTable.title,
      role: recordingCreditsTable.role,
      roleGroup: recordingCreditsTable.roleGroup,
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      albumTitle: recordingReleaseGroupsTable.title,
      albumYear: recordingReleaseGroupsTable.releaseYear,
    })
    .from(recordingCreditsTable)
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, recordingCreditsTable.recordingMbid))
    .leftJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingCreditsTable.recordingMbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
      ),
    )
    .where(eq(recordingCreditsTable.artistMbid, artistMbid))
    .orderBy(desc(recordingReleaseGroupsTable.releaseYear), asc(recordingCreditsTable.role), asc(recordingsTable.title));
  const creditedAlbums = [...new Map(
    creditedRows
      .filter((row) => row.releaseGroupMbid)
      .map((row) => [row.releaseGroupMbid, {
        releaseGroupMbid: row.releaseGroupMbid!,
        title: row.albumTitle,
        releaseYear: row.albumYear ?? null,
        href: `/album/${encodeURIComponent(row.releaseGroupMbid!)}`,
      }]),
  ).values()];
  const creditBacklinks = creditedRows
    .filter((row) => row.releaseGroupMbid)
    .map((row) => ({
      recordingMbid: row.recordingMbid,
      trackTitle: row.trackTitle,
      role: row.role,
      roleGroup: row.roleGroup,
      releaseGroupMbid: row.releaseGroupMbid,
      albumTitle: row.albumTitle,
      albumYear: row.albumYear ?? null,
      albumHref: `/album/${encodeURIComponent(row.releaseGroupMbid!)}`,
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
        const artistRef = await cataloguePort.searchArtist(artistName);
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
    name: artistName,
    topTracks,
    albums,
    creditedAlbums,
    creditBacklinks,
    catalogue,
  });
}));

export default router;
