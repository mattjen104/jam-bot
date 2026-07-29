import { Router, type IRouter } from "express";
import {
  db,
  recordingsTable,
  recordingReleaseGroupsTable,
  spinsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// GET /api/album/:releaseGroupMbid
// Returns all recordings in this release group with their Lore spin counts.
// The release group is the MusicBrainz concept that groups multiple releases
// (LP, remaster, etc.) of the same album under one identifier.
router.get("/album/:releaseGroupMbid", h(async (req, res) => {
  const releaseGroupMbid = String(req.params.releaseGroupMbid ?? "");
  if (!releaseGroupMbid) {
    return res.status(400).json({ error: "releaseGroupMbid required" });
  }

  // Resolve the release-group title and metadata from any row in the bridge
  // table (title + releaseYear are denormalised there from MusicBrainz).
  const [rgRow] = await db
    .select({
      title: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
      primaryType: recordingReleaseGroupsTable.primaryType,
    })
    .from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .limit(1);

  if (!rgRow || !rgRow.title) {
    return res.status(404).json({ error: "Album not found" });
  }

  // All recordings in this release group, joined with spin counts.
  // LEFT JOIN so recordings that have never aired still appear.
  const trackRows = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
      artworkUrl: recordingsTable.artworkUrl,
      spinCount: sql<number>`count(${spinsTable.id})::int`,
      lastSpunAt: sql<string | null>`max(${spinsTable.playedAt})`,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      recordingsTable,
      eq(recordingsTable.mbid, recordingReleaseGroupsTable.recordingMbid),
    )
    .leftJoin(spinsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .groupBy(
      recordingsTable.mbid,
      recordingsTable.title,
      recordingsTable.artist,
      recordingsTable.artistMbid,
      recordingsTable.artworkUrl,
    )
    .orderBy(desc(sql`count(${spinsTable.id})`));

  return res.json({
    releaseGroupMbid,
    title: rgRow.title,
    releaseYear: rgRow.releaseYear ?? null,
    primaryType: rgRow.primaryType ?? null,
    tracks: trackRows.map((r) => ({
      mbid: r.mbid,
      title: r.title,
      artist: r.artist,
      artistMbid: r.artistMbid ?? null,
      artworkUrl: r.artworkUrl ?? null,
      spinCount: r.spinCount,
      lastSpunAt: r.lastSpunAt ? new Date(r.lastSpunAt).toISOString() : null,
    })),
  });
}));

export default router;
