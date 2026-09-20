import {
  db,
  musicbrainzLabelsTable,
  musicbrainzReleasesTable,
  recordingCreditsTable,
  recordingReleaseGroupsTable,
  recordingsTable,
  releaseLabelsTable,
} from "@workspace/db";
import { asc, eq, inArray, sql } from "drizzle-orm";

/**
 * Provider-neutral album read model. Credit facts remain recording-scoped;
 * consumers must not promote these rows into album personnel without separate
 * release-group evidence.
 */
export async function getAlbumKnowledge(releaseGroupMbid: string) {
  const [meta] = await db.select({
    releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
    title: recordingReleaseGroupsTable.title,
    releaseYear: recordingReleaseGroupsTable.releaseYear,
    primaryType: recordingReleaseGroupsTable.primaryType,
  }).from(recordingReleaseGroupsTable)
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .orderBy(asc(recordingReleaseGroupsTable.id)).limit(1);
  if (!meta?.title) return null;

  const tracks = await db.select({
    mbid: recordingsTable.mbid,
    title: recordingsTable.title,
    artist: recordingsTable.artist,
    artistMbid: recordingsTable.artistMbid,
    artworkUrl: recordingsTable.artworkUrl,
    bridgePrimary: recordingReleaseGroupsTable.isPrimary,
  }).from(recordingReleaseGroupsTable)
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, recordingReleaseGroupsTable.recordingMbid))
    .where(eq(recordingReleaseGroupsTable.releaseGroupMbid, releaseGroupMbid))
    .orderBy(asc(recordingsTable.title), asc(recordingsTable.mbid));
  const recordingMbids = tracks.map((track) => track.mbid);
  const credits = recordingMbids.length ? await db.select({
    recordingMbid: recordingCreditsTable.recordingMbid,
    creditedName: recordingCreditsTable.creditedName,
    role: recordingCreditsTable.role,
    roleGroup: recordingCreditsTable.roleGroup,
    artistMbid: recordingCreditsTable.artistMbid,
    workMbid: recordingCreditsTable.workMbid,
    source: recordingCreditsTable.source,
    sourceUrl: recordingCreditsTable.sourceUrl,
    provenance: recordingCreditsTable.provenance,
    completeness: recordingCreditsTable.completeness,
    fetchedAt: recordingCreditsTable.fetchedAt,
    scope: sql<string>`'recording'`,
  }).from(recordingCreditsTable)
    .where(inArray(recordingCreditsTable.recordingMbid, recordingMbids))
    .orderBy(asc(recordingCreditsTable.recordingMbid), asc(recordingCreditsTable.roleGroup), asc(recordingCreditsTable.creditedName)) : [];
  const releases = await db.select({
    releaseMbid: musicbrainzReleasesTable.mbid,
    releaseGroupMbid: musicbrainzReleasesTable.releaseGroupMbid,
    title: musicbrainzReleasesTable.title,
    releaseDate: musicbrainzReleasesTable.releaseDate,
    status: musicbrainzReleasesTable.status,
    country: musicbrainzReleasesTable.country,
    source: musicbrainzReleasesTable.source,
    parserVersion: musicbrainzReleasesTable.parserVersion,
    fetchedAt: musicbrainzReleasesTable.fetchedAt,
    completeness: musicbrainzReleasesTable.completeness,
    labelMbid: musicbrainzLabelsTable.mbid,
    labelName: musicbrainzLabelsTable.name,
    catalogNumber: releaseLabelsTable.catalogNumber,
    labelSource: releaseLabelsTable.source,
    labelFetchedAt: releaseLabelsTable.fetchedAt,
  }).from(musicbrainzReleasesTable)
    .leftJoin(releaseLabelsTable, eq(releaseLabelsTable.releaseMbid, musicbrainzReleasesTable.mbid))
    .leftJoin(musicbrainzLabelsTable, eq(musicbrainzLabelsTable.mbid, releaseLabelsTable.labelMbid))
    .where(eq(musicbrainzReleasesTable.releaseGroupMbid, releaseGroupMbid));
  return {
    album: {
      ...meta,
      canonicalAlbumHref: `/album/${encodeURIComponent(releaseGroupMbid)}`,
    },
    ordering: "alphabetical-until-release-membership-enrichment",
    albumCredits: [],
    tracks: tracks.map((track) => ({
      ...track,
      trackPosition: null,
      credits: credits.filter((credit) => credit.recordingMbid === track.mbid),
    })),
    releases: releases.map((release) => ({
      ...release,
      fetchedAt: release.fetchedAt?.toISOString() ?? null,
      labelFetchedAt: release.labelFetchedAt?.toISOString() ?? null,
    })),
    provenance: {
      source: [...new Set([
        ...credits.map((credit) => credit.source),
        ...releases.map((release) => release.source),
      ].filter(Boolean))].join(" + ") || "musicbrainz",
      scope: "canonical-album",
    },
  };
}