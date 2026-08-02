import { Router, type IRouter } from "express";
import {
  GetStationRunParams,
  GetStationRunResponse,
  GetPickerRunParams,
  GetPickerRunResponse,
  GetArchiveRecentRunsResponse,
  GetArchiveRecentRunsQueryParams,
  GetArchiveCoverageResponse,
  GetStationRunInsightsParams,
  GetStationRunInsightsResponse,
  GetPickerRunInsightsParams,
  GetPickerRunInsightsResponse,
  SearchArtistRunsQueryParams,
  SearchArtistRunsResponse,
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
import { eq, and, or, asc, isNull, isNotNull, inArray, sql } from "drizzle-orm";
import { stationArchiveUrl, supportsBackfill } from "../../lore/adapters.js";
import { getPickerByHandle } from "../../lore/picks.js";
import { h } from "../../middlewares/asyncHandler.js";
import { toArchiveRecording, toPicker, spinDayExpr, isPickerOptedOut, pickerNotOptedOut } from "./shared.js";
import { computeGenreBreakdown, computeDiscoveryScore } from "../../lore/genre-insights.js";

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
    .where(and(eq(stationsTable.id, anchor.stationId), eq(stationsTable.hidden, false)))
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
          stationArchiveUrl(station.nowPlayingSource, anchor.day, station.nowPlayingConfig as Record<string, unknown> | null) ??
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

// GET /api/archive/station-runs/:runId/insights — genre breakdown + discovery
// score for one run's tracklist.
router.get("/archive/station-runs/:runId/insights", h(async (req, res) => {
  const parsed = GetStationRunInsightsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }

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

  const rows = await db
    .select({
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      playedAt: spinsTable.playedAt,
    })
    .from(spinsTable)
    .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(
      and(
        eq(spinsTable.stationId, anchor.stationId),
        anchor.showId == null
          ? isNull(spinsTable.showId)
          : eq(spinsTable.showId, anchor.showId),
        sql`${spinDayExpr} = ${anchor.day}`,
      ),
    );

  return res.json(
    GetStationRunInsightsResponse.parse({
      runId: parsed.data.runId,
      insights: {
        genreBreakdown: computeGenreBreakdown(rows),
        discoveryScore: computeDiscoveryScore(
          rows.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.playedAt })),
        ),
      },
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

  if (await isPickerOptedOut(picker.id)) {
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

// GET /api/archive/picker-runs/:runId/insights — genre breakdown + discovery
// score for one picker run's tracklist.
router.get("/archive/picker-runs/:runId/insights", h(async (req, res) => {
  const parsed = GetPickerRunInsightsParams.safeParse(req.params);
  if (!parsed.success) {
    return res.status(404).json({ error: "Run not found" });
  }

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

  if (await isPickerOptedOut(anchor.pickerId)) {
    return res.status(404).json({ error: "Run not found" });
  }

  const rows = await db
    .select({
      genres: recordingsTable.genres,
      releaseYear: recordingsTable.releaseYear,
      pickedAt: picksTable.pickedAt,
    })
    .from(picksTable)
    .innerJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
    .where(
      and(
        eq(picksTable.pickerId, anchor.pickerId),
        eq(picksTable.sourceUrl, anchor.sourceUrl),
      ),
    );

  const dated = rows.filter((r): r is typeof r & { pickedAt: Date } => r.pickedAt != null);
  return res.json(
    GetPickerRunInsightsResponse.parse({
      runId: parsed.data.runId,
      insights: {
        genreBreakdown: computeGenreBreakdown(rows),
        discoveryScore: computeDiscoveryScore(
          dated.map((r) => ({ releaseYear: r.releaseYear, airedAt: r.pickedAt })),
        ),
      },
    }),
  );
}));

// GET /api/archive/recent-runs — newest documented runs across every station.
// Ranking favors recency AND resolution quality.
// Supports cursor-based pagination via ?before=<opaque_cursor>.
const RECENT_RUNS_PAGE_SIZE = 50;

// The sort order is (date DESC, ratio DESC, maxPlayedAt DESC, runId DESC).
// The cursor encodes all four sort-key fields so the HAVING clause can do a
// correct lexicographic comparison that matches the ORDER BY exactly.
type RecentRunsCursor = {
  date: string;       // "YYYY-MM-DD"
  ratio: number;      // resolvedCount / spinCount
  maxPlayedAt: string; // ISO-8601 timestamp of the last spin
  runId: number;      // min(spins.id) — deterministic tiebreaker
};

function encodeRecentRunsCursor(c: RecentRunsCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeRecentRunsCursor(token: string): RecentRunsCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as Record<string, unknown>).date === "string" &&
      typeof (obj as Record<string, unknown>).ratio === "number" &&
      typeof (obj as Record<string, unknown>).maxPlayedAt === "string" &&
      typeof (obj as Record<string, unknown>).runId === "number"
    ) {
      return obj as RecentRunsCursor;
    }
    return null;
  } catch {
    return null;
  }
}

router.get("/archive/recent-runs", h(async (req, res) => {
  // Parse and validate the opaque cursor.
  const rawBefore = req.query.before;
  let cursor: RecentRunsCursor | null = null;
  if (rawBefore !== undefined) {
    if (typeof rawBefore !== "string" || rawBefore.length === 0) {
      return res.status(400).json({ error: "Invalid cursor" });
    }
    cursor = decodeRecentRunsCursor(rawBefore);
    if (!cursor) {
      return res.status(400).json({ error: "Invalid cursor" });
    }
  }

  // Keyset condition matching ORDER BY (date DESC, ratio DESC, maxPlayedAt DESC, runId DESC).
  // Lexicographic "less than" across all four sort fields:
  //   Row is "after" the cursor position when any earlier field is strictly
  //   smaller (DESC ⟹ smaller = further in the list) or all earlier fields
  //   are equal and the current field is strictly smaller.
  const ratioExpr = sql`(count(*) filter (where ${spinsTable.mbid} is not null))::float / nullif(count(*), 0)`;
  const havingClause = cursor
    ? sql`(
        ${spinDayExpr} < ${cursor.date}
        OR (
          ${spinDayExpr} = ${cursor.date}
          AND ${ratioExpr} < ${cursor.ratio}
        )
        OR (
          ${spinDayExpr} = ${cursor.date}
          AND ${ratioExpr} = ${cursor.ratio}
          AND max(${spinsTable.playedAt}) < ${cursor.maxPlayedAt}::timestamptz
        )
        OR (
          ${spinDayExpr} = ${cursor.date}
          AND ${ratioExpr} = ${cursor.ratio}
          AND max(${spinsTable.playedAt}) = ${cursor.maxPlayedAt}::timestamptz
          AND min(${spinsTable.id}) < ${cursor.runId}
        )
      )`
    : sql`1=1`;

  const rows = await db
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
    .having(havingClause)
    .orderBy(
      sql`${spinDayExpr} desc`,
      sql`(count(*) filter (where ${spinsTable.mbid} is not null))::float / nullif(count(*), 0) desc`,
      sql`max(${spinsTable.playedAt}) desc`,
      sql`min(${spinsTable.id}) desc`, // deterministic tiebreaker
    )
    // Fetch one extra row to detect whether there is a next page.
    .limit(RECENT_RUNS_PAGE_SIZE + 1);

  const hasMore = rows.length > RECENT_RUNS_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, RECENT_RUNS_PAGE_SIZE) : rows;

  // Build the next-page cursor from the last item on this page.
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeRecentRunsCursor({
          date: lastRow.date,
          ratio:
            lastRow.spinCount > 0
              ? lastRow.resolvedCount / lastRow.spinCount
              : 0,
          maxPlayedAt: new Date(lastRow.endedAt).toISOString(),
          runId: lastRow.runId,
        })
      : null;

  const stationIds = [...new Set(pageRows.map((r) => r.stationId))];
  const stations = stationIds.length
    ? await db
        .select()
        .from(stationsTable)
        .where(and(inArray(stationsTable.id, stationIds), eq(stationsTable.hidden, false)))
    : [];
  const stationById = new Map(stations.map((s) => [s.id, s]));

  return res.json(
    GetArchiveRecentRunsResponse.parse({
      items: pageRows.flatMap((r) => {
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
      nextCursor,
    }),
  );
}));

// GET /api/archive/artist-runs?q=… — find runs that include an artist.
// Matches raw spin/pick metadata AND resolved recording artists, then groups
// hits into runs. Run anchors (min id) are computed over the FULL partition —
// never just the matching rows — so runIds match the archive pages exactly.
router.get("/archive/artist-runs", h(async (req, res) => {
  // Explicit presence guard: zod.coerce would turn an absent param into the
  // literal string "undefined".
  if (typeof req.query.q !== "string" || req.query.q.trim().length === 0) {
    return res.status(400).json({ error: "Missing search query" });
  }
  const parsed = SearchArtistRunsQueryParams.safeParse({ q: req.query.q });
  if (!parsed.success) {
    return res.status(400).json({ error: "Missing search query" });
  }
  const q = parsed.data.q.trim();
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const artistMatch = or(
    sql`${spinsTable.rawArtist} ilike ${pattern}`,
    sql`${recordingsTable.artist} ilike ${pattern}`,
  )!;

  // 1. Which station-run groups contain the artist, and how many hits each?
  const spinGroups = await db
    .select({
      stationId: spinsTable.stationId,
      showId: spinsTable.showId,
      day: spinDayExpr,
      matchCount: sql<number>`count(*)::int`,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(artistMatch)
    .groupBy(spinsTable.stationId, spinsTable.showId, spinDayExpr)
    .orderBy(sql`${spinDayExpr} desc`, sql`count(*) desc`)
    .limit(25);

  // 2. Full-partition summaries for those groups (anchor id, total counts).
  let stationRuns: Array<{
    station: { slug: string; name: string; stationClass: string };
    run: {
      runId: number;
      date: string;
      show: { name: string; djName: string | null } | null;
      spinCount: number;
      resolvedCount: number;
      sourceUrl: string | null;
      startedAt: string;
      endedAt: string;
    };
    matchCount: number;
  }> = [];
  if (spinGroups.length > 0) {
    const groupFilter = or(
      ...spinGroups.map((g) =>
        and(
          eq(spinsTable.stationId, g.stationId),
          g.showId == null
            ? isNull(spinsTable.showId)
            : eq(spinsTable.showId, g.showId),
          sql`${spinDayExpr} = ${g.day}`,
        ),
      ),
    )!;
    const fullGroups = await db
      .select({
        stationId: spinsTable.stationId,
        showId: spinsTable.showId,
        day: spinDayExpr,
        runId: sql<number>`min(${spinsTable.id})`,
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
      .where(groupFilter)
      .groupBy(
        spinsTable.stationId,
        spinsTable.showId,
        spinDayExpr,
        showsTable.name,
        showsTable.djName,
      );

    const stationIds = [...new Set(fullGroups.map((g) => g.stationId))];
    const stations = stationIds.length
      ? await db
          .select()
          .from(stationsTable)
          .where(and(inArray(stationsTable.id, stationIds), eq(stationsTable.hidden, false)))
      : [];
    const stationById = new Map(stations.map((s) => [s.id, s]));
    const matchByKey = new Map(
      spinGroups.map((g) => [`${g.stationId}|${g.showId ?? "null"}|${g.day}`, g.matchCount]),
    );

    stationRuns = fullGroups
      .flatMap((g) => {
        const station = stationById.get(g.stationId);
        if (!station) return [];
        return [
          {
            station: {
              slug: station.slug,
              name: station.name,
              stationClass: station.stationClass,
            },
            run: {
              runId: g.runId,
              date: g.day,
              show: g.showName
                ? { name: g.showName, djName: g.djName ?? null }
                : null,
              spinCount: g.spinCount,
              resolvedCount: g.resolvedCount,
              sourceUrl:
                stationArchiveUrl(station.nowPlayingSource, g.day, station.nowPlayingConfig as Record<string, unknown> | null) ??
                g.citation ??
                null,
              startedAt: new Date(g.startedAt).toISOString(),
              endedAt: new Date(g.endedAt).toISOString(),
            },
            matchCount:
              matchByKey.get(`${g.stationId}|${g.showId ?? "null"}|${g.day}`) ?? 0,
          },
        ];
      })
      .sort(
        (a, b) =>
          b.run.date.localeCompare(a.run.date) || b.matchCount - a.matchCount,
      );
  }

  // 3. Same for picker runs: matching (picker, sourceUrl) groups…
  const pickGroups = await db
    .select({
      pickerId: picksTable.pickerId,
      sourceUrl: picksTable.sourceUrl,
      matchCount: sql<number>`count(*)::int`,
    })
    .from(picksTable)
    .leftJoin(recordingsTable, eq(picksTable.mbid, recordingsTable.mbid))
    .where(
      and(
        isNotNull(picksTable.sourceUrl),
        or(
          sql`${picksTable.rawArtist} ilike ${pattern}`,
          sql`${recordingsTable.artist} ilike ${pattern}`,
        ),
      ),
    )
    .groupBy(picksTable.pickerId, picksTable.sourceUrl)
    .orderBy(sql`count(*) desc`)
    .limit(25);

  let pickerRuns: Array<{
    picker: { name: string; handle: string; pickerType: string; trustTier: number };
    runId: number;
    title: string | null;
    sourceUrl: string;
    pickedAt: string | null;
    trackCount: number;
    matchCount: number;
  }> = [];
  if (pickGroups.length > 0) {
    // …then full-group summaries (anchor id over the whole list).
    const fullPickGroups = await db
      .select({
        pickerId: picksTable.pickerId,
        sourceUrl: picksTable.sourceUrl,
        runId: sql<number>`min(${picksTable.id})`,
        trackCount: sql<number>`count(*)::int`,
        title: sql<string | null>`max(${picksTable.context})`,
        pickedAt: sql<string | null>`min(${picksTable.pickedAt})`,
      })
      .from(picksTable)
      .where(
        or(
          ...pickGroups.map((g) =>
            and(
              eq(picksTable.pickerId, g.pickerId),
              eq(picksTable.sourceUrl, g.sourceUrl!),
            ),
          ),
        )!,
      )
      .groupBy(picksTable.pickerId, picksTable.sourceUrl);

    const pickerIds = [...new Set(fullPickGroups.map((g) => g.pickerId))];
    const pickers = pickerIds.length
      ? await db.select().from(pickersTable).where(
          and(inArray(pickersTable.id, pickerIds), pickerNotOptedOut(pickersTable.id)),
        )
      : [];
    const pickerById = new Map(pickers.map((p) => [p.id, p]));
    const pickMatchByKey = new Map(
      pickGroups.map((g) => [`${g.pickerId}|${g.sourceUrl}`, g.matchCount]),
    );

    pickerRuns = fullPickGroups
      .flatMap((g) => {
        const picker = pickerById.get(g.pickerId);
        if (!picker || g.sourceUrl == null) return [];
        return [
          {
            picker: {
              name: picker.name,
              handle: picker.handle,
              pickerType: picker.pickerType,
              trustTier: picker.trustTier,
            },
            runId: g.runId,
            title: g.title,
            sourceUrl: g.sourceUrl,
            pickedAt: g.pickedAt ? new Date(g.pickedAt).toISOString() : null,
            trackCount: g.trackCount,
            matchCount: pickMatchByKey.get(`${g.pickerId}|${g.sourceUrl}`) ?? 0,
          },
        ];
      })
      .sort((a, b) => b.matchCount - a.matchCount || b.runId - a.runId);
  }

  return res.json(
    SearchArtistRunsResponse.parse({ query: q, stationRuns, pickerRuns }),
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
    .where(eq(stationsTable.hidden, false))
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
    .where(pickerNotOptedOut(pickersTable.id))
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
