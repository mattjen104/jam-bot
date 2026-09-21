import { Router, type IRouter } from "express";
import {
  db,
  musicbrainzReleasesTable,
  musicbrainzWorksTable,
  recordingCreditsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  releaseLabelsTable,
} from "@workspace/db";
import { and, asc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { h } from "../middlewares/asyncHandler.js";

const router: IRouter = Router();

function single(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normalized(value: unknown): string | null {
  const text = single(value);
  return text ? text.toLowerCase().replace(/\s+/g, " ") : null;
}

function parseLimit(value: unknown): number {
  const parsed = Number(single(value) ?? "30");
  return Number.isInteger(parsed) ? Math.max(1, Math.min(parsed, 50)) : 30;
}

function decodeCursor(value: unknown): string | null {
  const encoded = single(value);
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    return decoded.length > 0 && decoded.length <= 512 ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/credits/discovery
 *
 * A bounded projection of facts Lore has already verified and cached. This
 * never calls MusicBrainz or a playback provider on the request path and never
 * claims to be a complete catalogue.
 */
router.get("/credits/discovery", h(async (req, res) => {
  const artistMbid = single(req.query.artistMbid);
  const role = normalized(req.query.role);
  const roleGroup = normalized(req.query.roleGroup);
  const workMbid = single(req.query.workMbid);
  const recordingMbid = single(req.query.recordingMbid);
  const releaseGroupMbid = single(req.query.releaseGroupMbid);
  const labelMbid = single(req.query.labelMbid);
  const otherArtists = single(req.query.otherArtists) === "true";
  const encodedCursor = single(req.query.cursor);
  const cursor = decodeCursor(req.query.cursor);
  const limit = parseLimit(req.query.limit);

  if (encodedCursor && !cursor) {
    return res.status(400).json({ error: "Invalid credit discovery cursor" });
  }
  if (!artistMbid && !role && !roleGroup && !workMbid && !recordingMbid && !releaseGroupMbid && !labelMbid) {
    return res.status(400).json({ error: "At least one credit filter is required" });
  }
  if (otherArtists && !artistMbid) {
    return res.status(400).json({ error: "otherArtists requires artistMbid" });
  }

  const filters = [
    artistMbid ? eq(recordingCreditsTable.artistMbid, artistMbid) : undefined,
    role ? eq(recordingCreditsTable.role, role) : undefined,
    roleGroup ? eq(recordingCreditsTable.roleGroup, roleGroup) : undefined,
    workMbid ? eq(recordingCreditsTable.workMbid, workMbid) : undefined,
    recordingMbid ? eq(recordingCreditsTable.recordingMbid, recordingMbid) : undefined,
    otherArtists && artistMbid
      ? or(isNull(recordingsTable.artistMbid), ne(recordingsTable.artistMbid, artistMbid))
      : undefined,
    cursor ? gt(recordingCreditsTable.creditKey, cursor) : undefined,
  ].filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));

  const selection = {
    creditKey: recordingCreditsTable.creditKey,
    creditedArtistMbid: recordingCreditsTable.artistMbid,
    creditedArtistKind: recordingCreditsTable.artistKind,
    creditedName: recordingCreditsTable.creditedName,
    role: recordingCreditsTable.role,
    roleGroup: recordingCreditsTable.roleGroup,
    workMbid: recordingCreditsTable.workMbid,
    workTitle: musicbrainzWorksTable.title,
    recordingMbid: recordingsTable.mbid,
    recordingTitle: recordingsTable.title,
    primaryArtistMbid: recordingsTable.artistMbid,
    primaryArtistName: recordingsTable.artist,
    source: recordingCreditsTable.source,
    sourceUrl: recordingCreditsTable.sourceUrl,
    parserVersion: recordingCreditsTable.parserVersion,
    provenance: recordingCreditsTable.provenance,
    completeness: recordingCreditsTable.completeness,
    attemptStatus: recordingCreditsTable.attemptStatus,
    fetchedAt: recordingCreditsTable.fetchedAt,
  };
  let creditQuery = db.selectDistinctOn([recordingCreditsTable.creditKey], selection)
    .from(recordingCreditsTable)
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, recordingCreditsTable.recordingMbid))
    .leftJoin(musicbrainzWorksTable, eq(musicbrainzWorksTable.mbid, recordingCreditsTable.workMbid))
    .$dynamic();
  if (releaseGroupMbid || labelMbid) {
    creditQuery = creditQuery.innerJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingCreditsTable.recordingMbid),
        releaseGroupMbid
          ? eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid)
          : undefined,
      ),
    );
  }
  if (labelMbid) {
    creditQuery = creditQuery
      .innerJoin(
        musicbrainzReleasesTable,
        eq(musicbrainzReleasesTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid),
      )
      .innerJoin(
        releaseLabelsTable,
        and(
          eq(releaseLabelsTable.releaseMbid, musicbrainzReleasesTable.mbid),
          eq(releaseLabelsTable.labelMbid, labelMbid),
        ),
      );
  }
  const rows = await creditQuery
    .where(and(...filters))
    .orderBy(asc(recordingCreditsTable.creditKey))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const recordingMbids = [...new Set(page.map((row) => row.recordingMbid))];
  const membershipRows = recordingMbids.length
    ? (await db.execute<{
        recordingMbid: string;
        mbid: string;
        title: string | null;
        year: number | null;
        isPrimary: boolean;
      }>(sql`
        WITH target(recording_mbid) AS (
          VALUES ${sql.join(recordingMbids.map((mbid) => sql`(${mbid})`), sql`, `)}
        )
        SELECT
          target.recording_mbid AS "recordingMbid",
          membership.release_group_mbid AS mbid,
          membership.title,
          membership.release_year AS year,
          membership.is_primary AS "isPrimary"
        FROM target
        JOIN LATERAL (
          SELECT rrg.release_group_mbid, rrg.title, rrg.release_year, rrg.is_primary
          FROM recording_release_groups rrg
          WHERE rrg.recording_mbid = target.recording_mbid
          ORDER BY
            CASE
              WHEN ${releaseGroupMbid ?? ""} <> ''
                AND rrg.release_group_mbid = ${releaseGroupMbid ?? ""} THEN 0
              WHEN ${labelMbid ?? ""} <> ''
                AND EXISTS (
                  SELECT 1
                  FROM musicbrainz_releases mr_priority
                  JOIN release_labels rl_priority ON rl_priority.release_mbid = mr_priority.mbid
                  WHERE mr_priority.release_group_mbid = rrg.release_group_mbid
                    AND rl_priority.label_mbid = ${labelMbid ?? ""}
                ) THEN 0
              ELSE 1
            END,
            rrg.is_primary DESC,
            rrg.id ASC
          LIMIT 8
        ) membership ON true
      `)).rows
    : [];
  const releaseGroupMbids = [...new Set(membershipRows.map((row) => row.mbid))];
  const releaseRows = releaseGroupMbids.length
    ? (await db.execute<{
        releaseGroupMbid: string;
        releaseMbid: string;
        releaseTitle: string | null;
        releaseDate: string | null;
        releaseStatus: string | null;
        country: string | null;
        labelMbid: string | null;
        labelName: string | null;
        catalogNumber: string | null;
      }>(sql`
        WITH target(release_group_mbid) AS (
          VALUES ${sql.join(releaseGroupMbids.map((mbid) => sql`(${mbid})`), sql`, `)}
        )
        SELECT
          target.release_group_mbid AS "releaseGroupMbid",
          fact.release_mbid AS "releaseMbid",
          fact.release_title AS "releaseTitle",
          fact.release_date AS "releaseDate",
          fact.release_status AS "releaseStatus",
          fact.country,
          fact.label_mbid AS "labelMbid",
          fact.label_name AS "labelName",
          fact.catalog_number AS "catalogNumber"
        FROM target
        JOIN LATERAL (
          SELECT
            mr.mbid AS release_mbid,
            mr.title AS release_title,
            mr.release_date,
            mr.status AS release_status,
            mr.country,
            ml.mbid AS label_mbid,
            ml.name AS label_name,
            rl.catalog_number
          FROM musicbrainz_releases mr
          LEFT JOIN release_labels rl ON rl.release_mbid = mr.mbid
          LEFT JOIN musicbrainz_labels ml ON ml.mbid = rl.label_mbid
          WHERE mr.release_group_mbid = target.release_group_mbid
          ORDER BY
            CASE
              WHEN ${labelMbid ?? ""} <> '' AND rl.label_mbid = ${labelMbid ?? ""} THEN 0
              ELSE 1
            END,
            mr.mbid ASC,
            ml.mbid ASC NULLS LAST
          LIMIT 8
        ) fact ON true
      `)).rows
    : [];

  return res.json({
    items: page.map((row) => ({
      creditKey: row.creditKey,
      creditedArtist: row.creditedArtistMbid
        ? { mbid: row.creditedArtistMbid, name: row.creditedName, kind: row.creditedArtistKind }
        : null,
      creditedName: row.creditedName,
      role: row.role,
      roleGroup: row.roleGroup,
      work: row.workMbid ? { mbid: row.workMbid, title: row.workTitle } : null,
      recording: {
        mbid: row.recordingMbid,
        title: row.recordingTitle,
        primaryArtistMbid: row.primaryArtistMbid,
        primaryArtistName: row.primaryArtistName,
      },
      releaseGroups: membershipRows
        .filter((membership) => membership.recordingMbid === row.recordingMbid)
        .map((membership) => ({
          mbid: membership.mbid,
          title: membership.title,
          year: membership.year,
          isPrimary: membership.isPrimary,
        })),
      releases: releaseRows
        .filter((release) => membershipRows.some((membership) =>
          membership.recordingMbid === row.recordingMbid
          && membership.mbid === release.releaseGroupMbid,
        ))
        .slice(0, 8)
        .map((release) => ({
          mbid: release.releaseMbid,
          title: release.releaseTitle,
          date: release.releaseDate,
          status: release.releaseStatus,
          country: release.country,
          label: release.labelMbid ? {
            mbid: release.labelMbid,
            name: release.labelName,
            catalogNumber: release.catalogNumber,
          } : null,
        })),
      completeness: row.completeness,
      attemptStatus: row.attemptStatus,
      provenance: {
        source: row.source,
        sourceUrl: row.sourceUrl,
        parserVersion: row.parserVersion,
        fetchedAt: row.fetchedAt?.toISOString() ?? null,
        detail: row.provenance,
      },
    })),
    nextCursor: rows.length > limit
      ? Buffer.from(page.at(-1)!.creditKey, "utf8").toString("base64url")
      : null,
    filters: { artistMbid, role, roleGroup, workMbid, recordingMbid, releaseGroupMbid, labelMbid, otherArtists },
    coverage: {
      scope: "lore-indexed-corpus",
      exhaustive: false,
      copy: "Verified credits in Lore's indexed corpus. MusicBrainz may contain additional relationships.",
      nestedLimits: { releaseGroupsPerRecording: 8, releaseFactsPerReleaseGroup: 8, releaseFactsPerCredit: 8 },
    },
  });
}));

export default router;