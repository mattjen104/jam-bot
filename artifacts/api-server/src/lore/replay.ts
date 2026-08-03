import {
  db,
  pickersTable,
  recordingsTable,
  showsTable,
  spinsTable,
  stationsTable,
  serviceTrackMapTable,
} from "@workspace/db";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { spinDayExpr } from "./runs.js";
import {
  isPickerOptedOut,
  toArchiveRecording,
  validScheduleShowAttribution,
} from "../routes/lore/shared.js";

/**
 * Ghost Replay is a read model over the spin archive. It deliberately has no
 * table of its own: the first spin in a station/show/day partition is its
 * stable public identifier.
 */
export interface ReplayManifest {
  replayId: number;
  station: {
    slug: string;
    name: string;
    stationClass: string;
  };
  show: { name: string; djName: string | null } | null;
  picker: {
    name: string;
    handle: string;
    pickerType: string;
    trustTier: number;
  } | null;
  bounds: {
    date: string;
    startedAt: string;
    endedAt: string;
  };
  coverage: {
    total: number;
    resolved: number;
    unresolved: number;
  };
  entries: Array<{
    position: number;
    spinId: number;
    playedAt: string;
    source: string | null;
    citation: string | null;
    rawArtist: string;
    rawTitle: string;
    confidence: string;
    recording: ReturnType<typeof toArchiveRecording>;
    guidedLinks: Array<{
      service: string;
      externalId: string | null;
      url: string;
      deadLink: boolean;
    }>;
  }>;
}

type ReplayAnchor = {
  stationId: number;
  showId: number | null;
  date: string;
  replayId: number;
};

/**
 * Resolve the station-run partition and its canonical anchor. Replay URLs are
 * intentionally canonical: a non-anchor member spin is not another replay id.
 */
async function resolveAnchor(id: number): Promise<ReplayAnchor | null> {
  const [spin] = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      date: spinDayExpr,
    })
    .from(spinsTable)
    .where(eq(spinsTable.id, id))
    .limit(1);
  if (!spin) return null;

  const [anchor] = await db
    .select({ replayId: sql<number>`min(${spinsTable.id})` })
    .from(spinsTable)
    .where(
      and(
        eq(spinsTable.stationId, spin.stationId),
        spin.showId == null ? isNull(spinsTable.showId) : eq(spinsTable.showId, spin.showId),
        sql`${spinDayExpr} = ${spin.date}`,
      ),
    );
  if (!anchor?.replayId) return null;
  if (anchor.replayId !== id) return null;

  return {
    stationId: spin.stationId,
    showId: spin.showId,
    date: spin.date,
    replayId: anchor.replayId,
  };
}

/** Build the canonical, server-owned manifest for one archived station run. */
export async function getReplayManifest(id: number): Promise<ReplayManifest | null> {
  const anchor = await resolveAnchor(id);
  if (!anchor) return null;

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.id, anchor.stationId), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) return null;

  const rows = await db
    .select({
      id: spinsTable.id,
      playedAt: spinsTable.playedAt,
      source: spinsTable.source,
      citation: spinsTable.citation,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      confidence: spinsTable.confidence,
      mbid: recordingsTable.mbid,
      recTitle: recordingsTable.title,
      recArtist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      showName: showsTable.name,
      djName: showsTable.djName,
      pickerId: showsTable.pickerId,
      pickerName: pickersTable.name,
      pickerHandle: pickersTable.handle,
      pickerType: pickersTable.pickerType,
      pickerTrustTier: pickersTable.trustTier,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .leftJoin(pickersTable, eq(showsTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(spinsTable.stationId, anchor.stationId),
        anchor.showId == null ? isNull(spinsTable.showId) : eq(spinsTable.showId, anchor.showId),
        sql`${spinDayExpr} = ${anchor.date}`,
      ),
    )
    .orderBy(asc(spinsTable.playedAt), asc(spinsTable.id));

  // A run with no rows cannot be a shareable reconstruction. This also keeps
  // a deleted/partially migrated archive from becoming a misleading manifest.
  if (rows.length === 0) return null;

  const mbids = rows.flatMap((row) => (row.mbid ? [row.mbid] : []));
  const guidedLinksByMbid = new Map<
    string,
    Array<{ service: string; externalId: string | null; url: string; deadLink: boolean }>
  >();
  if (mbids.length) {
    const maps = await db
      .select({
        recordingMbid: serviceTrackMapTable.recordingMbid,
        service: serviceTrackMapTable.service,
        externalId: serviceTrackMapTable.externalId,
        url: serviceTrackMapTable.url,
        deadLink: serviceTrackMapTable.deadLink,
      })
      .from(serviceTrackMapTable)
      .where(
        and(
          inArray(serviceTrackMapTable.recordingMbid, mbids),
          // Exclude negative-cache (embed_miss) sentinel rows that have no URL.
          isNotNull(serviceTrackMapTable.url),
        ),
      );
    for (const map of maps) {
      const links = guidedLinksByMbid.get(map.recordingMbid) ?? [];
      links.push({
        service: map.service,
        externalId: map.externalId ?? null,
        // url is guaranteed non-null by the WHERE clause above.
        url: map.url!,
        deadLink: map.deadLink,
      });
      guidedLinksByMbid.set(map.recordingMbid, links);
    }
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const resolved = rows.filter((row) => row.mbid != null).length;
  const hasPicker =
    first.pickerId != null &&
    first.pickerName != null &&
    first.pickerHandle != null &&
    first.pickerType != null &&
    first.pickerTrustTier != null;
  const pickerOptedOut =
    first.pickerId != null && (await isPickerOptedOut(first.pickerId));

  return {
    replayId: anchor.replayId,
    station: {
      slug: station.slug,
      name: station.name,
      stationClass: station.stationClass,
    },
    show: first.showName
      ? { name: first.showName, djName: first.djName ?? null }
      : null,
    picker: hasPicker && !pickerOptedOut
      ? {
          name: first.pickerName!,
          handle: first.pickerHandle!,
          pickerType: first.pickerType!,
          trustTier: first.pickerTrustTier!,
        }
      : null,
    bounds: {
      date: anchor.date,
      startedAt: first.playedAt.toISOString(),
      endedAt: last.playedAt.toISOString(),
    },
    coverage: {
      total: rows.length,
      resolved,
      unresolved: rows.length - resolved,
    },
    entries: rows.map((row, position) => ({
      position,
      spinId: row.id,
      playedAt: row.playedAt.toISOString(),
      source: row.source ?? null,
      citation: row.citation ?? null,
      rawArtist: row.rawArtist ?? "",
      rawTitle: row.rawTitle ?? "",
      confidence: row.confidence,
      recording: toArchiveRecording(row),
      guidedLinks: row.mbid ? guidedLinksByMbid.get(row.mbid) ?? [] : [],
    })),
  };
}