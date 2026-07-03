import { Router, type IRouter } from "express";
import {
  GetStationRunParams,
  GetStationRunResponse,
  GetPickerRunParams,
  GetPickerRunResponse,
  GetArchiveRecentRunsResponse,
  GetArchiveCoverageResponse,
} from "@workspace/api-zod";
import {
  db,
  spinsTable,
  stationsTable,
  showsTable,
  recordingsTable,
  pickersTable,
  picksTable,
} from "@workspace/db";
import { eq, and, asc, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl, supportsBackfill } from "../../lore/adapters.js";
import { getPickerByHandle } from "../../lore/picks.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toArchiveRecording, toPicker, spinDayExpr } from "./shared.js";

const router: IRouter = Router();

// GET /api/archive/station-runs/:runId — one run's tracklist, as it aired.
router.get("/archive/station-runs/:runId", h(async (req, res) => {
  const parsed = GetStationRunParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }

  // The anchor spin defines the run: its station + show + UTC broadcast day.
  const [anchor] = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      day: spinDayExpr,
    })
    .from(spinsTable)
    .where(eq(spinsTable.id, parsed.data.runId))
    .limit(1);
  if (!anchor) {
    return res.status(404).json({ error: "Run not found" });
  }

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(eq(stationsTable.id, anchor.stationId))
    .limit(1);
  if (!station) {
    return res.status(404).json({ error: "Run not found" });
  }

  const rows = await db
    .select({
      id: spinsTable.id,
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      confidence: spinsTable.confidence,
      citation: spinsTable.citation,
      mbid: recordingsTable.mbid,
      recTitle: recordingsTable.title,
      recArtist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      showName: showsTable.name,
      djName: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(
      and(
        eq(spinsTable.stationId, anchor.stationId),
        anchor.showId == null
          ? isNull(spinsTable.showId)
          : eq(spinsTable.showId, anchor.showId),
        sql`${spinDayExpr} = ${anchor.day}`,
      ),
    )
    .orderBy(asc(spinsTable.playedAt), asc(spinsTable.id));
  if (!rows.length) {
    return res.status(404).json({ error: "Run not found" });
  }

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  return res.json(
    GetStationRunResponse.parse({
      station: {
        slug: station.slug,
        name: station.name,
        stationClass: station.stationClass,
      },
      run: {
        runId: parsed.data.runId,
        date: anchor.day,
        show: first.showName
          ? { name: first.showName, djName: first.djName ?? null }
          : null,
        spinCount: rows.length,
        resolvedCount: rows.filter((r) => r.mbid != null).length,
        sourceUrl:
          stationArchiveUrl(station.nowPlayingSource, anchor.day) ??
          rows.map((r) => r.citation).find((c) => c != null) ??
          null,
        startedAt: first.playedAt.toISOString(),
        endedAt: last.playedAt.toISOString(),
      },
      tracks: rows.map((r, i) => ({
        position: i,
        playedAt: r.playedAt.toISOString(),
        rawArtist: r.rawArtist ?? "",
        rawTitle: r.rawTitle ?? "",
        confidence: r.confidence,
        recording: toArchiveRecording(r),
      })),
    }),
  );
}));

// GET /api/archive/picker-runs/:runId — one run's picks, in documented order.
router.get("/archive/picker-runs/:runId", h(async (req, res) => {
  const parsed = GetPickerRunParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }

  // The anchor pick defines the run: its picker + source URL.
  const [anchor] = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
    })
    .from(picksTable)
    .where(eq(picksTable.id, parsed.data.runId))
    .limit(1);
  if (!anchor || !anchor.sourceUrl) {
    return res.status(404).json({ error: "Run not found" });
  }

  const [picker] = await db
    .select()
    .from(pickersTable)
    .where(eq(pickersTable.id, anchor.pickerId))
    .limit(1);
  if (!picker) {
    return res.status(404).json({ error: "Run not found" });
  }

  const rows = await db
    .select({
      id: picksTable.id,
      ordinal: picksTable.ordinal,
      pickedAt: picksTable.pickedAt,
      context: picksTable.context,
      rawArtist: picksTable.rawArtist,
      rawTitle: picksTable.rawTitle,
      confidence: picksTable.confidence,
      mbid: recordingsTable.mbid,
      recTitle: recordingsTable.title,
      recArtist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
    })
    .from(picksTable)
    .leftJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
    .where(
      and(
        eq(picksTable.pickerId, anchor.pickerId),
        eq(picksTable.sourceUrl, anchor.sourceUrl),
      ),
    )
    .orderBy(sql`${picksTable.ordinal} asc nulls last`, asc(picksTable.id));
  if (!rows.length) {
    return res.status(404).json({ error: "Run not found" });
  }

  const pickedAt = rows.map((r) => r.pickedAt).find((d) => d != null) ?? null;
  return res.json(
    GetPickerRunResponse.parse({
      picker: toPicker(picker),
      run: {
        runId: parsed.data.runId,
        title: rows[0]!.context ?? null,
        sourceUrl: anchor.sourceUrl,
        pickedAt: pickedAt ? pickedAt.toISOString() : null,
        trackCount: rows.length,
        resolvedCount: rows.filter((r) => r.mbid != null).length,
      },
      tracks: rows.map((r, i) => ({
        position: r.ordinal ?? i,
        playedAt: r.pickedAt ? r.pickedAt.toISOString() : null,
        rawArtist: r.rawArtist ?? "",
        rawTitle: r.rawTitle ?? "",
        confidence: r.confidence,
        recording: toArchiveRecording(r),
      })),
    }),
  );
}));

// GET /api/archive/recent-runs — newest documented runs across every station.
// Ranking favors recency AND resolution quality.
router.get("/archive/recent-runs", h(async (_req, res) => {
  const runs = await db
    .select({
      runId: sql<number>`min(${spinsTable.id})`,
      date: spinDayExpr,
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      citation: sql<string | null>`max(${spinsTable.citation})`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
      showName: showsTable.name,
      djName: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .groupBy(
      spinsTable.stationId,
      spinDayExpr,
      spinsTable.showId,
      showsTable.name,
      showsTable.djName,
    )
    .orderBy(
      sql`${spinDayExpr} desc`,
      sql`(count(*) filter (where ${spinsTable.mbid} is not null))::float / count(*) desc`,
      sql`max(${spinsTable.playedAt}) desc`,
    )
    .limit(40);

  const stationIds = [...new Set(runs.map((r) => r.stationId))];
  const stations = stationIds.length
    ? await db.select().from(stationsTable).where(inArray(stationsTable.id, stationIds))
    : [];
  const stationById = new Map(stations.map((s) => [s.id, s]));

  return res.json(
    GetArchiveRecentRunsResponse.parse({
      items: runs.flatMap((r) => {
        const station = stationById.get(r.stationId);
        if (!station) return [];
        return [
          {
            station: {
              slug: station.slug,
              name: station.name,
              stationClass: station.stationClass,
            },
            run: {
              runId: r.runId,
              date: r.date,
              show: r.showName
                ? { name: r.showName, djName: r.djName ?? null }
                : null,
              spinCount: r.spinCount,
              resolvedCount: r.resolvedCount,
              sourceUrl:
                stationArchiveUrl(station.nowPlayingSource, r.date) ??
                r.citation ??
                null,
              startedAt: new Date(r.startedAt).toISOString(),
              endedAt: new Date(r.endedAt).toISOString(),
            },
          },
        ];
      }),
    }),
  );
}));

// GET /api/archive/coverage — how deep the archive goes, per source.
router.get("/archive/coverage", h(async (_req, res) => {
  const stationRows = await db
    .select({
      slug: stationsTable.slug,
      name: stationsTable.name,
      source: stationsTable.nowPlayingSource,
      backfillDone: stationsTable.backfillDone,
      backfillCursor: stationsTable.backfillCursor,
      spinCount: sql<number>`count(${spinsTable.id})::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      oldestSpinAt: sql<string | null>`min(${spinsTable.playedAt})`,
      newestSpinAt: sql<string | null>`max(${spinsTable.playedAt})`,
    })
    .from(stationsTable)
    .leftJoin(spinsTable, eq(spinsTable.stationId, stationsTable.id))
    .groupBy(
      stationsTable.id,
      stationsTable.slug,
      stationsTable.name,
      stationsTable.nowPlayingSource,
      stationsTable.backfillDone,
      stationsTable.backfillCursor,
    )
    .orderBy(sql`count(${spinsTable.id}) desc`);

  const pickerRows = await db
    .select({
      handle: pickersTable.handle,
      name: pickersTable.name,
      runCount: sql<number>`count(distinct ${picksTable.sourceUrl}) filter (where ${picksTable.sourceUrl} is not null)::int`,
      pickCount: sql<number>`count(${picksTable.id})::int`,
      resolvedCount: sql<number>`count(*) filter (where ${picksTable.mbid} is not null)::int`,
      oldestPickedAt: sql<string | null>`min(${picksTable.pickedAt})`,
      newestPickedAt: sql<string | null>`max(${picksTable.pickedAt})`,
    })
    .from(pickersTable)
    .innerJoin(picksTable, eq(picksTable.pickerId, pickersTable.id))
    .groupBy(pickersTable.id, pickersTable.handle, pickersTable.name)
    .orderBy(sql`count(${picksTable.id}) desc`);

  return res.json(
    GetArchiveCoverageResponse.parse({
      stations: stationRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        spinCount: r.spinCount,
        resolvedCount: r.resolvedCount,
        oldestSpinAt: r.oldestSpinAt ? new Date(r.oldestSpinAt).toISOString() : null,
        newestSpinAt: r.newestSpinAt ? new Date(r.newestSpinAt).toISOString() : null,
        supportsBackfill: supportsBackfill(r.source),
        backfillDone: r.backfillDone,
        backfillCursor: r.backfillCursor ?? null,
      })),
      pickers: pickerRows.map((r) => ({
        handle: r.handle,
        name: r.name,
        runCount: r.runCount,
        pickCount: r.pickCount,
        resolvedCount: r.resolvedCount,
        oldestPickedAt: r.oldestPickedAt
          ? new Date(r.oldestPickedAt).toISOString()
          : null,
        newestPickedAt: r.newestPickedAt
          ? new Date(r.newestPickedAt).toISOString()
          : null,
      })),
    }),
  );
}));

export default router;
