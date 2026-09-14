import { Router, type IRouter, type Request, type Response } from "express";
import {
  creditEnrichmentQueueTable,
  db,
  libraryItemsTable,
  musicbrainzLabelsTable,
  musicbrainzReleasesTable,
  recordingCreditsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  releaseLabelsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

function kept(userId: number) {
  return and(eq(libraryItemsTable.userId, userId), isNull(libraryItemsTable.removedAt));
}

function statusShape(status: string | undefined, hasRows: boolean) {
  if (status === "complete" || status === "partial" || status === "unavailable") return status;
  if (status === "deferred") return "deferred";
  if (status === "running") return "pending";
  return hasRows ? "partial" : "pending";
}

export function aggregateAlbumStatus(
  statuses: string[],
  hasFacts: boolean,
): "pending" | "complete" | "partial" | "deferred" | "unavailable" {
  const unique = new Set(statuses);
  if (unique.has("partial")) return "partial";
  if (unique.has("unavailable") && (hasFacts || unique.size > 1)) return "partial";
  if (unique.has("deferred") && hasFacts) return "partial";
  if (unique.has("deferred")) return "deferred";
  if (unique.has("unavailable")) return "unavailable";
  if (unique.has("pending") || unique.has("running")) return "pending";
  if (unique.size > 0 && unique.size === 1 && unique.has("complete")) return "complete";
  return hasFacts ? "partial" : "pending";
}

function aggregateProvenance(
  rows: Array<{ parserVersion?: string | null; fetchedAt?: Date | null }>,
  scope: string,
) {
  const parserVersions = [...new Set(rows.map((row) => row.parserVersion).filter(Boolean))];
  const fetchedAt = rows
    .map((row) => row.fetchedAt?.toISOString())
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    source: "musicbrainz",
    scope,
    parserVersion: parserVersions.length === 1 ? parserVersions[0] : null,
    fetchedAt,
  };
}

/**
 * GET /api/me/credits/recordings/:mbid
 *
 * A credit payload is only readable for an active Keep. This is the server
 * boundary that prevents Radio and unkept catalogue surfaces from acquiring
 * expensive/full credit metadata.
 */
router.get("/me/credits/recordings/:mbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const mbid = String(req.params.mbid ?? "").trim();
  if (!mbid) return res.status(400).json({ error: "mbid is required" });
  const [recording] = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artistMbid: recordingsTable.artistMbid,
    })
    .from(recordingsTable)
    .innerJoin(
      libraryItemsTable,
      and(eq(libraryItemsTable.mbid, recordingsTable.mbid), kept(user.id)),
    )
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!recording) return res.status(404).json({ error: "Recording is not kept" });

  const credits = await db
    .select()
    .from(recordingCreditsTable)
    .where(eq(recordingCreditsTable.recordingMbid, mbid))
    .orderBy(asc(recordingCreditsTable.roleGroup), asc(recordingCreditsTable.creditedName));
  const releases = await db
    .select({
      releaseMbid: musicbrainzReleasesTable.mbid,
      releaseGroupMbid: musicbrainzReleasesTable.releaseGroupMbid,
      title: musicbrainzReleasesTable.title,
      releaseDate: musicbrainzReleasesTable.releaseDate,
      status: musicbrainzReleasesTable.status,
      country: musicbrainzReleasesTable.country,
      parserVersion: musicbrainzReleasesTable.parserVersion,
      fetchedAt: musicbrainzReleasesTable.fetchedAt,
      provenance: musicbrainzReleasesTable.provenance,
      labelMbid: musicbrainzLabelsTable.mbid,
      labelName: musicbrainzLabelsTable.name,
      catalogNumber: releaseLabelsTable.catalogNumber,
      labelParserVersion: releaseLabelsTable.parserVersion,
      labelFetchedAt: releaseLabelsTable.fetchedAt,
      labelProvenance: releaseLabelsTable.provenance,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      musicbrainzReleasesTable,
      eq(musicbrainzReleasesTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid),
    )
    .leftJoin(releaseLabelsTable, eq(releaseLabelsTable.releaseMbid, musicbrainzReleasesTable.mbid))
    .leftJoin(musicbrainzLabelsTable, eq(musicbrainzLabelsTable.mbid, releaseLabelsTable.labelMbid))
    .where(eq(recordingReleaseGroupsTable.recordingMbid, mbid));
  const [queue] = await db
    .select({ status: creditEnrichmentQueueTable.status, lastError: creditEnrichmentQueueTable.lastError })
    .from(creditEnrichmentQueueTable)
    .where(eq(creditEnrichmentQueueTable.recordingMbid, mbid))
    .limit(1);
  return res.json({
    recording,
    credits,
    releases,
    status: statusShape(queue?.status, credits.length > 0),
    error: queue?.lastError ?? null,
    provenance: aggregateProvenance(
      [...credits, ...releases].map((row) => ({
        parserVersion: "parserVersion" in row ? row.parserVersion : null,
        fetchedAt: "fetchedAt" in row ? row.fetchedAt : null,
      })),
      "kept-recording",
    ),
  });
}));

/**
 * GET /api/me/credits/albums/:releaseGroupMbid
 * Album membership is proved by a kept recording's canonical release-group
 * bridge. The response contains the same normalized recording credit rows as
 * the song endpoint, grouped per recording for album investigation.
 */
router.get("/me/credits/albums/:releaseGroupMbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const releaseGroupMbid = String(req.params.releaseGroupMbid ?? "").trim();
  if (!releaseGroupMbid) return res.status(400).json({ error: "releaseGroupMbid is required" });
  const keptTracks = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      position: recordingReleaseGroupsTable.id,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      libraryItemsTable,
      and(eq(libraryItemsTable.mbid, recordingReleaseGroupsTable.recordingMbid), kept(user.id)),
    )
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, recordingReleaseGroupsTable.recordingMbid))
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .orderBy(asc(recordingReleaseGroupsTable.id));
  if (!keptTracks.length) return res.status(404).json({ error: "Album is not represented by a kept song" });
  const [releaseGroup] = await db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      title: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
    })
    .from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .limit(1);
  const releases = await db
    .select({
      releaseMbid: musicbrainzReleasesTable.mbid,
      title: musicbrainzReleasesTable.title,
      releaseDate: musicbrainzReleasesTable.releaseDate,
      status: musicbrainzReleasesTable.status,
      country: musicbrainzReleasesTable.country,
      parserVersion: musicbrainzReleasesTable.parserVersion,
      fetchedAt: musicbrainzReleasesTable.fetchedAt,
      provenance: musicbrainzReleasesTable.provenance,
      labelMbid: musicbrainzLabelsTable.mbid,
      labelName: musicbrainzLabelsTable.name,
      catalogNumber: releaseLabelsTable.catalogNumber,
      labelParserVersion: releaseLabelsTable.parserVersion,
      labelFetchedAt: releaseLabelsTable.fetchedAt,
      labelProvenance: releaseLabelsTable.provenance,
    })
    .from(musicbrainzReleasesTable)
    .leftJoin(releaseLabelsTable, eq(releaseLabelsTable.releaseMbid, musicbrainzReleasesTable.mbid))
    .leftJoin(musicbrainzLabelsTable, eq(musicbrainzLabelsTable.mbid, releaseLabelsTable.labelMbid))
    .where(eq(musicbrainzReleasesTable.releaseGroupMbid, releaseGroupMbid));
  const recordingMbids = keptTracks.map((track) => track.mbid);
  const credits = await db
    .select()
    .from(recordingCreditsTable)
    .where(inArray(recordingCreditsTable.recordingMbid, recordingMbids));
  const queueRows = await db
    .select({ status: creditEnrichmentQueueTable.status })
    .from(creditEnrichmentQueueTable)
    .where(inArray(creditEnrichmentQueueTable.recordingMbid, recordingMbids));
  const status = aggregateAlbumStatus(
    [
      ...queueRows.map((row) => row.status),
      ...Array(Math.max(0, recordingMbids.length - queueRows.length)).fill("pending"),
    ],
    credits.length > 0 || releases.length > 0,
  );
  return res.json({
    album: releaseGroup,
    tracks: keptTracks.map((track) => ({
      ...track,
      credits: credits.filter((credit) => credit.recordingMbid === track.mbid),
    })),
    releases,
    status,
    provenance: aggregateProvenance(
      [...credits, ...releases].map((row) => ({
        parserVersion: "parserVersion" in row ? row.parserVersion : null,
        fetchedAt: "fetchedAt" in row ? row.fetchedAt : null,
      })),
      "kept-album",
    ),
  });
}));

/** Credited artist/person discovery, restricted to active kept recordings. */
const artistDiscovery = h(async (req: Request, res: Response) => {
  const user = (req as AuthedRequest).loreUser;
  const artistMbid = String(req.params.artistMbid ?? "").trim();
  if (!artistMbid) return res.status(400).json({ error: "artistMbid is required" });
  const rows = await db
    .select({
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      role: recordingCreditsTable.role,
      roleGroup: recordingCreditsTable.roleGroup,
      creditedName: recordingCreditsTable.creditedName,
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
    .innerJoin(
      libraryItemsTable,
      and(eq(libraryItemsTable.mbid, recordingCreditsTable.recordingMbid), kept(user.id)),
    )
    .where(eq(recordingCreditsTable.artistMbid, artistMbid));
  return res.json({
    artistMbid,
    songs: rows,
    count: rows.length,
    scope: "kept-only",
    provenance: { source: "musicbrainz", verifiedIdentity: true },
  });
});
router.get("/me/credits/artists/:artistMbid", artistDiscovery);
router.get("/me/credits/identities/:artistMbid", artistDiscovery);

/** Label discovery is release-scoped and never claims a complete catalogue. */
router.get("/me/credits/labels/:labelMbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const labelMbid = String(req.params.labelMbid ?? "").trim();
  if (!labelMbid) return res.status(400).json({ error: "labelMbid is required" });
  const rows = await db
    .select({
      releaseMbid: musicbrainzReleasesTable.mbid,
      releaseGroupMbid: musicbrainzReleasesTable.releaseGroupMbid,
      title: musicbrainzReleasesTable.title,
      releaseDate: musicbrainzReleasesTable.releaseDate,
      catalogNumber: releaseLabelsTable.catalogNumber,
      labelMbid: musicbrainzLabelsTable.mbid,
      labelName: musicbrainzLabelsTable.name,
    })
    .from(releaseLabelsTable)
    .innerJoin(musicbrainzLabelsTable, eq(musicbrainzLabelsTable.mbid, releaseLabelsTable.labelMbid))
    .innerJoin(musicbrainzReleasesTable, eq(musicbrainzReleasesTable.mbid, releaseLabelsTable.releaseMbid))
    .innerJoin(
      recordingReleaseGroupsTable,
      eq(recordingReleaseGroupsTable.releaseGroupMbid, musicbrainzReleasesTable.releaseGroupMbid),
    )
    .innerJoin(
      libraryItemsTable,
      and(eq(libraryItemsTable.mbid, recordingReleaseGroupsTable.recordingMbid), kept(user.id)),
    )
    .where(eq(releaseLabelsTable.labelMbid, labelMbid));
  const deduped = [...new Map(rows.map((row) => [row.releaseMbid, row])).values()];
  return res.json({
    labelMbid,
    labelName: deduped[0]?.labelName ?? null,
    releases: deduped,
    count: deduped.length,
    scope: "kept-only",
    completeCatalogue: false,
    provenance: { source: "musicbrainz", verifiedIdentity: true },
  });
}));

export default router;