import { Router, type IRouter } from "express";
import {
  db,
  recordingsTable,
  recordingReleaseGroupsTable,
  spinsTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
} from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import {
  GetReleaseGroupListProvenanceParams,
  GetReleaseGroupListProvenanceResponse,
} from "@workspace/api-zod";

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

// GET /api/album/:releaseGroupMbid/list-provenance
// Returns publication list entries that feature this release group directly.
router.get("/album/:releaseGroupMbid/list-provenance", h(async (req, res) => {
  const parsed = GetReleaseGroupListProvenanceParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid release group MBID" });
  }
  const { releaseGroupMbid } = parsed.data;

  // Join: list_entries → lists → list_sources
  // Also pull title/year from any recordingReleaseGroups row for display.
  const [rgMeta] = await db
    .select({
      title: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
    })
    .from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .limit(1);

  const rows = await db
    .select({
      listId: listsTable.id,
      listTitle: listsTable.title,
      listYear: listsTable.year,
      listUrl: listsTable.url,
      listKind: listsTable.kind,
      isRanked: listsTable.isRanked,
      listLength: listsTable.listLength,
      sourceName: listSourcesTable.name,
      rank: listEntriesTable.rank,
      releaseGroupMbid: listEntriesTable.releaseGroupMbid,
    })
    .from(listEntriesTable)
    .innerJoin(listsTable, eq(listsTable.id, listEntriesTable.listId))
    .innerJoin(listSourcesTable, eq(listSourcesTable.id, listsTable.sourceId))
    .where(
      and(
        eq(listEntriesTable.releaseGroupMbid, releaseGroupMbid),
        sql`(${listEntriesTable.confidence} = 'exact' OR ${listEntriesTable.confirmed} = true)`,
      ),
    )
    .orderBy(
      sql`${listEntriesTable.rank} asc nulls last`,
      sql`${listsTable.year} desc nulls last`,
    );

  return res.json(
    GetReleaseGroupListProvenanceResponse.parse({
      items: rows.map((r) => ({
        listId: r.listId,
        listTitle: r.listTitle,
        listYear: r.listYear ?? null,
        listUrl: r.listUrl,
        listKind: r.listKind,
        isRanked: r.isRanked,
        listLength: r.listLength ?? null,
        sourceName: r.sourceName,
        rank: r.rank ?? null,
        releaseGroupMbid: r.releaseGroupMbid,
        releaseGroupTitle: rgMeta?.title ?? null,
        releaseYear: rgMeta?.releaseYear ?? null,
      })),
    }),
  );
}));

export default router;
