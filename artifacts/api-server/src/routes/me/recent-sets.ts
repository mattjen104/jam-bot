/**
 * GET /api/me/recent-sets — completed show runs from the archive, with
 * per-artist crossing data relative to the authenticated listener's library.
 *
 * Response: { items: RecentSetItem[], nextCursor?: string }
 * Each item: { station, run, artists: [{ name, spins, popular, inLibrary }] }
 *
 * Query params:
 *   window=all|today|yesterday|week|month|year  (default: all)
 *   cursor   opaque pagination token (keyset on endedAt DESC, runId DESC)
 */
import { Router, type IRouter } from "express";
import {
  db,
  spinsTable,
  stationsTable,
  showsTable,
  recordingsTable,
  libraryItemsTable,
  spotifyLibraryItemsTable,
  tasteSeedsTable,
} from "@workspace/db";
import { eq, and, isNull, ne, sql, gte, lt } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";
import { spinDayExpr, validScheduleShowAttribution } from "../lore/shared.js";

const router: IRouter = Router();

// Same junk filter as crossings.ts — keeps URL/domain noise out of sentences.
const JUNK_ARTIST_SQL_RE =
  String.raw`(^https?://|[.](com|net|org|edu|gov|io|fm|co|info|biz|music|radio|ca|uk|au|de|fr|es|it|nl|se|no|dk|fi|pl|ru|cz|at|ch|be|pt|nz|mx|br|ar|za|in|sg|hk|jp|us)([/?#[:space:]]|$))`;

const POPULAR_TOP_N = 100;
const RECENT_SETS_PAGE_SIZE = 30;

type RecentSetWindow = "all" | "today" | "yesterday" | "week" | "month" | "year";

type RecentSetsCursor = { endedAt: string; runId: number };

function windowBounds(w: RecentSetWindow): { start: Date | null; end: Date | null } {
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const yesterdayUtc = new Date(todayUtc.getTime() - 86_400_000);
  switch (w) {
    case "all":
      return { start: null, end: null };
    case "today":
      return { start: todayUtc, end: null };
    case "yesterday":
      return { start: yesterdayUtc, end: todayUtc };
    case "week":
      return { start: new Date(todayUtc.getTime() - 7 * 86_400_000), end: null };
    case "month":
      return { start: new Date(todayUtc.getTime() - 30 * 86_400_000), end: null };
    case "year":
      return { start: new Date(todayUtc.getTime() - 365 * 86_400_000), end: null };
  }
}

function decodeCursor(token: string): RecentSetsCursor | null {
  try {
    const obj = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
    if (
      typeof obj === "object" &&
      obj !== null &&
      typeof (obj as Record<string, unknown>).endedAt === "string" &&
      typeof (obj as Record<string, unknown>).runId === "number"
    ) {
      // Validate endedAt is a real timestamp — a structurally valid but
      // non-date string would otherwise cause a Postgres cast error (500).
      const ts = new Date((obj as Record<string, unknown>).endedAt as string);
      if (isNaN(ts.getTime())) return null;
      return obj as RecentSetsCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(c: RecentSetsCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

router.get("/me/recent-sets", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  // ── Parse window ───────────────────────────────────────────────────────────
  const VALID_WINDOWS: RecentSetWindow[] = ["all", "today", "yesterday", "week", "month", "year"];
  const rawWindow = req.query.window;
  const window: RecentSetWindow =
    typeof rawWindow === "string" && VALID_WINDOWS.includes(rawWindow as RecentSetWindow)
      ? (rawWindow as RecentSetWindow)
      : "all";

  // ── Parse cursor ───────────────────────────────────────────────────────────
  const rawCursor = req.query.cursor;
  let cursor: RecentSetsCursor | null = null;
  if (rawCursor !== undefined) {
    if (typeof rawCursor !== "string" || !rawCursor) {
      return res.status(400).json({ error: "Invalid cursor" });
    }
    cursor = decodeCursor(rawCursor);
    if (!cursor) return res.status(400).json({ error: "Invalid cursor" });
  }

  const bounds = windowBounds(window);

  // ── Build WHERE clause for spins ───────────────────────────────────────────
  const whereParts = [];
  if (bounds.start) whereParts.push(gte(spinsTable.playedAt, bounds.start));
  if (bounds.end) whereParts.push(lt(spinsTable.playedAt, bounds.end));
  const spinsWhere = whereParts.length > 0 ? and(...whereParts) : undefined;

  // ── Cursor HAVING clause ───────────────────────────────────────────────────
  const cursorHaving = cursor
    ? sql`(
        max(${spinsTable.playedAt}) < ${cursor.endedAt}::timestamptz
        OR (
          max(${spinsTable.playedAt}) = ${cursor.endedAt}::timestamptz
          AND min(${spinsTable.id}) < ${cursor.runId}
        )
      )`
    : sql`1=1`;

  // ── Fetch paginated runs — hidden stations excluded at DB level ────────────
  // Inner-joining stations with hidden=false ensures the LIMIT counts only
  // visible rows, so page sizes are always full and nextCursor is trustworthy.
  const rows = await db
    .select({
      runId: sql<number>`min(${spinsTable.id})`,
      date: spinDayExpr,
      stationId: spinsTable.stationId,
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      stationClass: stationsTable.stationClass,
      showId: spinsTable.showId,
      spinCount: sql<number>`count(*)::int`,
      resolvedCount: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null)::int`,
      startedAt: sql<string>`min(${spinsTable.playedAt})`,
      endedAt: sql<string>`max(${spinsTable.playedAt})`,
      showName: showsTable.name,
      djName: showsTable.djName,
    })
    .from(spinsTable)
    .innerJoin(
      stationsTable,
      and(
        eq(spinsTable.stationId, stationsTable.id),
        eq(stationsTable.hidden, false),
      ),
    )
    .leftJoin(
      showsTable,
      and(eq(spinsTable.showId, showsTable.id), validScheduleShowAttribution()),
    )
    .where(spinsWhere)
    .groupBy(
      spinsTable.stationId,
      stationsTable.slug,
      stationsTable.name,
      stationsTable.stationClass,
      spinDayExpr,
      spinsTable.showId,
      showsTable.name,
      showsTable.djName,
    )
    .having(cursorHaving)
    .orderBy(
      sql`max(${spinsTable.playedAt}) desc`,
      sql`min(${spinsTable.id}) desc`,
    )
    .limit(RECENT_SETS_PAGE_SIZE + 1);

  const hasMore = rows.length > RECENT_SETS_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, RECENT_SETS_PAGE_SIZE) : rows;

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({
          endedAt: new Date(lastRow.endedAt).toISOString(),
          runId: lastRow.runId,
        })
      : null;

  if (pageRows.length === 0) {
    return res.json({ items: [], nextCursor });
  }

  // ── Fetch user library artists for inLibrary flag ──────────────────────────
  const [libRows, softRows, seedRows] = await Promise.all([
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${recordingsTable.artist}))` })
      .from(libraryItemsTable)
      .innerJoin(recordingsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
      .where(eq(libraryItemsTable.userId, user.id)),
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
      .from(spotifyLibraryItemsTable)
      .where(
        and(
          eq(spotifyLibraryItemsTable.userId, user.id),
          isNull(spotifyLibraryItemsTable.mbid),
          ne(spotifyLibraryItemsTable.artist, ""),
        ),
      ),
    db
      .selectDistinct({ akey: sql<string>`lower(trim(${tasteSeedsTable.artistName}))` })
      .from(tasteSeedsTable)
      .where(eq(tasteSeedsTable.userId, user.id)),
  ]);
  const inLibSet = new Set([...libRows, ...softRows, ...seedRows].map((r) => r.akey));

  // ── Fetch artists for all visible runs via a single SQL query ──────────────
  // Filter by the union of station IDs on this page + the same date bounds used
  // by the main query (or the 180-day cutoff for unbounded windows).  This keeps
  // the query shape stable regardless of page size, avoiding prepared-statement
  // cache conflicts that arise from a variable-length OR predicate.
  const scanCutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const uniqueStationIds = [...new Set(pageRows.map((r) => r.stationId))];
  // ARRAY[…]::integer[] pattern per drizzle raw-SQL convention (sql.array() absent).
  const stationArray = sql`ARRAY[${sql.join(uniqueStationIds.map((id) => sql`${id}`), sql`, `)}]::integer[]`;
  const effectiveLower = bounds.start ?? scanCutoff;
  const upperBoundClause = bounds.end ? sql`AND s.played_at < ${bounds.end}` : sql``;

  // EXISTS with a GROUP BY outer query causes "subquery uses ungrouped column"
  // in Postgres (code 42803).  Use a LEFT JOIN on popular + bool_or() aggregate
  // instead — the join key lower(trim(r.artist)) IS in the GROUP BY.
  const artistRes = await db.execute(sql`
    WITH popular AS (
      SELECT lower(trim(r2.artist)) AS akey
      FROM spins s2
      JOIN recordings r2 ON r2.mbid = s2.mbid
      WHERE s2.played_at >= ${scanCutoff}
        AND r2.artist !~* ${JUNK_ARTIST_SQL_RE}
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT ${POPULAR_TOP_N}
    )
    SELECT
      s.station_id,
      s.show_id,
      DATE(s.played_at AT TIME ZONE 'UTC')  AS run_date,
      lower(trim(r.artist))                 AS akey,
      min(trim(r.artist))                   AS name,
      count(*)::int                         AS spins,
      bool_or(pop.akey IS NOT NULL)         AS popular
    FROM spins s
    JOIN recordings r  ON r.mbid = s.mbid
    LEFT JOIN popular pop ON pop.akey = lower(trim(r.artist))
    WHERE s.station_id = ANY(${stationArray})
      AND s.played_at >= ${effectiveLower}
      ${upperBoundClause}
      AND s.mbid IS NOT NULL
      AND r.artist !~* ${JUNK_ARTIST_SQL_RE}
    GROUP BY s.station_id, s.show_id, DATE(s.played_at AT TIME ZONE 'UTC'), lower(trim(r.artist))
    ORDER BY s.station_id, s.show_id, DATE(s.played_at AT TIME ZONE 'UTC'), count(*) DESC
  `);

  // Map artists back to runs using (stationId, showId, date) key
  type ArtistRow = {
    station_id: number;
    show_id: number | null;
    run_date: string;
    akey: string;
    name: string;
    spins: number;
    popular: boolean;
  };

  const artistsByRunKey = new Map<
    string,
    Array<{ name: string; spins: number; popular: boolean; inLibrary: boolean }>
  >();

  for (const ar of artistRes.rows as ArtistRow[]) {
    const key = `${ar.station_id}|${ar.show_id ?? ""}|${ar.run_date}`;
    const list = artistsByRunKey.get(key) ?? [];
    list.push({
      name: String(ar.name),
      spins: Number(ar.spins),
      popular: Boolean(ar.popular),
      inLibrary: inLibSet.has(String(ar.akey)),
    });
    artistsByRunKey.set(key, list);
  }

  // ── Build response items ───────────────────────────────────────────────────
  // Station data is now inlined from the joined query — no second lookup needed.
  const items = pageRows.map((r) => {
    const runKey = `${r.stationId}|${r.showId ?? ""}|${r.date}`;
    const artists = artistsByRunKey.get(runKey) ?? [];
    return {
      station: {
        slug: r.stationSlug,
        name: r.stationName,
        stationClass: r.stationClass,
      },
      run: {
        runId: r.runId,
        date: r.date,
        startedAt: new Date(r.startedAt).toISOString(),
        endedAt: new Date(r.endedAt).toISOString(),
        spinCount: r.spinCount,
        resolvedCount: r.resolvedCount,
        show:
          r.showName
            ? { name: r.showName, djName: r.djName ?? null }
            : null,
      },
      artists,
    };
  });

  return res.json({ items, nextCursor });
}));

export default router;
