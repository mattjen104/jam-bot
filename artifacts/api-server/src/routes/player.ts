import { Router, type IRouter } from "express";
import {
  db,
  stationsTable,
  spinsTable,
  showsTable,
  recordingsTable,
  libraryItemsTable,
  trackClaimsTable,
  songExploderEpisodesTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  listsTable,
  picksTable,
  pickersTable,
  scrapedShowsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, isNotNull, gte } from "drizzle-orm";
import { getUserFromSession } from "../lore/userSession.js";
import { toStation, isPickerOptedOut } from "./lore/shared.js";
import { resolveAutomationClass } from "../lore/scraped-shows-sync.js";
import { h } from "../middlewares/asyncHandler.js";

/**
 * Webplayer read-models — plain-JSON endpoints consumed by the /player front
 * end via hand-written fetch hooks (no OpenAPI/orval involvement, mirroring
 * the /api/me/* pattern). All endpoints work anonymously; when a session
 * exists, library-overlap fields are populated.
 *
 * Mounted BEFORE loreRouter (admin catch-all would otherwise 503 these).
 */
const router: IRouter = Router();

/** A station is "on the air" if it logged a spin within this window. */
const ON_AIR_WINDOW_MS = 90 * 60 * 1000;
/** Earlier-artist summaries look back this far. */
const EARLIER_WINDOW_MS = 6 * 60 * 60 * 1000;
/** Max earlier artists shown per row. */
const EARLIER_MAX = 3;
/** Max MBIDs per lore-counts batch. */
const LORE_COUNTS_MAX = 60;
/** Deep-cut cards in the run drawer trove. */
const DEEP_CUTS_MAX = 3;

// ---------------------------------------------------------------------------
// GET /api/player/onair — live stations sorted by the user's library overlap
// ---------------------------------------------------------------------------

router.get("/player/onair", h(async (req, res) => {
  const user = await getUserFromSession(req).catch(() => null);

  const stations = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.active, true), eq(stationsTable.hidden, false)));

  // Latest spin per station, with resolved recording + show.
  const latest = await db
    .selectDistinctOn([spinsTable.stationId], {
      stationId: spinsTable.stationId,
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(isNotNull(spinsTable.stationId))
    .orderBy(asc(spinsTable.stationId), desc(spinsTable.playedAt));

  // Recent spins for "earlier: A, B, C" summaries.
  const earlierSince = new Date(Date.now() - EARLIER_WINDOW_MS);
  const recent = await db
    .select({
      stationId: spinsTable.stationId,
      playedAt: spinsTable.playedAt,
      artist: recordingsTable.artist,
      rawArtist: spinsTable.rawArtist,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(gte(spinsTable.playedAt, earlierSince))
    .orderBy(desc(spinsTable.playedAt))
    .limit(600);

  // Library match counts per station (distinct library MBIDs ever spun).
  const matchByStation = new Map<number, number>();
  if (user) {
    const userLib = db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, user.id));
    const rows = await db
      .select({
        stationId: spinsTable.stationId,
        matches: sql<number>`count(distinct ${spinsTable.mbid})::int`,
      })
      .from(spinsTable)
      .where(and(isNotNull(spinsTable.mbid), inArray(spinsTable.mbid, userLib)))
      .groupBy(spinsTable.stationId);
    for (const r of rows) {
      if (r.stationId != null) matchByStation.set(r.stationId, r.matches);
    }
  }

  const latestByStation = new Map(latest.map((r) => [r.stationId, r]));
  const earlierByStation = new Map<number, string[]>();
  for (const r of recent) {
    if (r.stationId == null) continue;
    const name = r.artist ?? r.rawArtist;
    if (!name) continue;
    const list = earlierByStation.get(r.stationId) ?? [];
    if (list.length === 0) {
      // First (most recent) entry per station is the "now" artist — skip it.
      earlierByStation.set(r.stationId, [name]);
      continue;
    }
    if (list.length < EARLIER_MAX + 1 && !list.includes(name)) {
      list.push(name);
      earlierByStation.set(r.stationId, list);
    }
  }

  const cutoff = Date.now() - ON_AIR_WINDOW_MS;
  const now = new Date();
  const itemsRaw = await Promise.all(
    stations.map(async (s) => {
      const spin = latestByStation.get(s.id);
      if (!spin || spin.playedAt.getTime() < cutoff) return null;
      const earlier = (earlierByStation.get(s.id) ?? []).slice(1);
      const resolvedClass = await resolveAutomationClass(
        s.id,
        s.ianaTimezone,
        s.automationClass ?? null,
        now,
      );
      return {
        station: toStation(s, undefined, resolvedClass),
        show:
          spin.showName != null
            ? { name: spin.showName, djName: spin.showDj ?? null }
            : null,
        now: {
          mbid: spin.mbid ?? null,
          title: spin.title ?? spin.rawTitle,
          artist: spin.artist ?? spin.rawArtist,
          artworkUrl: spin.artworkUrl ?? null,
          playedAt: spin.playedAt.toISOString(),
          resolved: spin.mbid != null,
        },
        earlier,
        matchCount: user ? matchByStation.get(s.id) ?? 0 : null,
      };
    }),
  );
  const items = itemsRaw.filter((x): x is NonNullable<typeof x> => x !== null)
    .sort(
      (a, b) =>
        (b.matchCount ?? -1) - (a.matchCount ?? -1) ||
        new Date(b.now.playedAt).getTime() - new Date(a.now.playedAt).getTime(),
    );

  return res.json({ items, authenticated: user != null });
}));

// ---------------------------------------------------------------------------
// GET /api/player/run/:slug — tonight's run for a station, split by library
// ---------------------------------------------------------------------------

router.get("/player/run/:slug", h(async (req, res) => {
  const slug = typeof req.params.slug === "string" ? req.params.slug : "";
  const user = await getUserFromSession(req).catch(() => null);

  const [station] = await db
    .select()
    .from(stationsTable)
    .where(and(eq(stationsTable.slug, slug), eq(stationsTable.hidden, false)))
    .limit(1);
  if (!station) return res.status(404).json({ error: "Station not found" });

  // Anchor: by default the station's latest spin defines tonight's
  // (show, UTC day) run. With ?runId=<anchor spin id> (the min-spin-id run
  // anchor used across the archive) a specific past run is requested instead
  // — that spin's show + UTC day become the partition.
  const runIdRaw = typeof req.query.runId === "string" ? req.query.runId : "";
  const runId = /^\d+$/.test(runIdRaw) ? Number(runIdRaw) : null;

  const anchorQuery = db
    .select({
      showId: spinsTable.showId,
      day: sql<string>`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      showName: showsTable.name,
      showDj: showsTable.djName,
    })
    .from(spinsTable)
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id));

  const [anchor] =
    runId != null
      ? await anchorQuery
          .where(and(eq(spinsTable.id, runId), eq(spinsTable.stationId, station.id)))
          .limit(1)
      : await anchorQuery
          .where(eq(spinsTable.stationId, station.id))
          .orderBy(desc(spinsTable.playedAt))
          .limit(1);
  if (!anchor)
    return res.status(404).json({
      error: runId != null ? "Run not found for this station" : "No spins for this station yet",
    });

  const partition = and(
    eq(spinsTable.stationId, station.id),
    anchor.showId == null
      ? sql`${spinsTable.showId} is null`
      : eq(spinsTable.showId, anchor.showId),
    sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${anchor.day}`,
  );

  const spins = await db
    .select({
      playedAt: spinsTable.playedAt,
      rawArtist: spinsTable.rawArtist,
      rawTitle: spinsTable.rawTitle,
      mbid: recordingsTable.mbid,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(spinsTable)
    .leftJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
    .where(partition)
    .orderBy(desc(spinsTable.playedAt))
    .limit(200);

  // Which of tonight's resolved MBIDs are in the user's library?
  const resolvedMbids = [...new Set(spins.map((s) => s.mbid).filter((m): m is string => m != null))];
  const inLib = new Set<string>();
  if (user && resolvedMbids.length > 0) {
    const rows = await db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(
        and(
          eq(libraryItemsTable.userId, user.id),
          inArray(libraryItemsTable.mbid, resolvedMbids),
        ),
      );
    for (const r of rows) inLib.add(r.mbid);
  }

  const items = spins.map((s) => ({
    mbid: s.mbid ?? null,
    title: s.title ?? s.rawTitle,
    artist: s.artist ?? s.rawArtist,
    artworkUrl: s.artworkUrl ?? null,
    playedAt: s.playedAt.toISOString(),
    resolved: s.mbid != null,
    inLibrary: s.mbid != null && inLib.has(s.mbid),
  }));

  const resolvedCount = items.filter((i) => i.resolved).length;
  const ownedCount = items.filter((i) => i.inLibrary).length;
  const overlapPct =
    user && resolvedCount > 0 ? Math.round((100 * ownedCount) / resolvedCount) : null;

  // ── Selector trove: shared recordings + deep cuts from past runs ─────────
  let trove: {
    selectorName: string;
    sharedCount: number;
    deepCuts: Array<{ artist: string; spinCount: number; runCount: number }>;
  } | null = null;

  if (user && anchor.showId != null) {
    const userLib = db
      .select({ mbid: libraryItemsTable.mbid })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, user.id));

    const [shared] = await db
      .select({ n: sql<number>`count(distinct ${spinsTable.mbid})::int` })
      .from(spinsTable)
      .where(
        and(
          eq(spinsTable.showId, anchor.showId),
          isNotNull(spinsTable.mbid),
          inArray(spinsTable.mbid, userLib),
        ),
      );

    const tonightArtists = new Set(
      items.map((i) => i.artist?.toLowerCase()).filter(Boolean),
    );

    const cuts = await db
      .select({
        artist: recordingsTable.artist,
        spinCount: sql<number>`count(*)::int`,
        runCount: sql<number>`count(distinct to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD'))::int`,
      })
      .from(spinsTable)
      .innerJoin(recordingsTable, eq(spinsTable.mbid, recordingsTable.mbid))
      .where(
        and(
          eq(spinsTable.showId, anchor.showId),
          sql`to_char(${spinsTable.playedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD') <> ${anchor.day}`,
          sql`${spinsTable.mbid} not in (${userLib})`,
        ),
      )
      .groupBy(recordingsTable.artist)
      .orderBy(sql`count(*) desc`)
      .limit(DEEP_CUTS_MAX + 6);

    trove = {
      selectorName: anchor.showDj ?? anchor.showName ?? station.name,
      sharedCount: shared?.n ?? 0,
      deepCuts: cuts
        .filter((c) => !tonightArtists.has(c.artist.toLowerCase()))
        .slice(0, DEEP_CUTS_MAX)
        .map((c) => ({ artist: c.artist, spinCount: c.spinCount, runCount: c.runCount })),
    };
  }

  return res.json({
    station: { slug: station.slug, name: station.name },
    show:
      anchor.showName != null
        ? { name: anchor.showName, djName: anchor.showDj ?? null }
        : null,
    day: anchor.day,
    spinCount: items.length,
    overlapPct,
    fromLibrary: items.filter((i) => i.inLibrary),
    newToYou: items.filter((i) => !i.inLibrary),
    trove,
    authenticated: user != null,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/for-you — top 5 past runs ranked by library overlap
// ---------------------------------------------------------------------------

router.get("/player/for-you", h(async (req, res) => {
  const user = await getUserFromSession(req).catch(() => null);
  if (!user) return res.status(401).json({ error: "Login required" });

  // CTE: user's library MBIDs
  // Aggregate spins into (station, show, UTC-day) run partitions, counting
  // how many resolved MBIDs overlap the user's library. Returns top 5 by
  // overlap%, ties broken by recency (most recent run first).
  const result = await db.execute(sql`
    WITH user_lib AS (
      SELECT mbid FROM library_items WHERE user_id = ${user.id}
    )
    SELECT
      st.slug,
      st.name                                               AS station_name,
      sh.id                                                 AS show_id,
      sh.name                                               AS show_name,
      sh.dj_name,
      to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
      MIN(s.id)::int                                        AS run_id,
      COUNT(DISTINCT s.mbid) FILTER (WHERE s.mbid IS NOT NULL)::int
                                                            AS total_resolved,
      COUNT(DISTINCT s.mbid) FILTER (
        WHERE s.mbid IN (SELECT mbid FROM user_lib)
      )::int                                                AS match_count,
      ROUND(
        100.0
        * COUNT(DISTINCT s.mbid) FILTER (
            WHERE s.mbid IN (SELECT mbid FROM user_lib)
          )
        / NULLIF(
            COUNT(DISTINCT s.mbid) FILTER (WHERE s.mbid IS NOT NULL),
            0
          )
      )::int                                                AS overlap_pct
    FROM   spins s
    JOIN   stations st ON s.station_id = st.id AND st.hidden = false
    LEFT JOIN shows sh ON s.show_id    = sh.id
    WHERE  s.station_id IS NOT NULL
      AND  s.played_at  >= NOW() - INTERVAL '90 days'
    GROUP BY
      st.slug, st.name,
      sh.id, sh.name, sh.dj_name,
      to_char(s.played_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
    HAVING COUNT(DISTINCT s.mbid) FILTER (
      WHERE s.mbid IN (SELECT mbid FROM user_lib)
    ) > 0
    ORDER BY overlap_pct DESC, day DESC
    LIMIT 5
  `);

  const rows = result.rows as Array<{
    slug: string;
    station_name: string;
    show_id: number | null;
    show_name: string | null;
    dj_name: string | null;
    day: string;
    run_id: number;
    total_resolved: number;
    match_count: number;
    overlap_pct: number;
  }>;

  const runs = rows.map((r) => ({
    slug: r.slug,
    stationName: r.station_name,
    showName: r.show_name ?? null,
    djName: r.dj_name ?? null,
    day: r.day,
    runId: Number(r.run_id),
    totalResolved: Number(r.total_resolved),
    matchCount: Number(r.match_count),
    overlapPct: Number(r.overlap_pct),
  }));

  return res.json({ runs });
}));

// ---------------------------------------------------------------------------
// GET /api/player/lore-counts?mbids=a,b,c — chip counts per recording
// ---------------------------------------------------------------------------

router.get("/player/lore-counts", h(async (req, res) => {
  const raw = typeof req.query.mbids === "string" ? req.query.mbids : "";
  const mbids = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(
    0,
    LORE_COUNTS_MAX,
  );
  if (mbids.length === 0) return res.json({ items: [] });

  const user = await getUserFromSession(req).catch(() => null);

  const [claims, seEpisodes, listRows, pickRows, libRows] = await Promise.all([
    db
      .select({
        mbid: trackClaimsTable.mbid,
        n: sql<number>`count(*)::int`,
      })
      .from(trackClaimsTable)
      .where(
        and(
          inArray(trackClaimsTable.mbid, mbids),
          eq(trackClaimsTable.status, "published"),
        ),
      )
      .groupBy(trackClaimsTable.mbid),
    db
      .select({ mbid: songExploderEpisodesTable.mbid })
      .from(songExploderEpisodesTable)
      .where(inArray(songExploderEpisodesTable.mbid, mbids)),
    db
      .select({
        mbid: recordingReleaseGroupsTable.recordingMbid,
        n: sql<number>`count(distinct ${listEntriesTable.listId})::int`,
      })
      .from(listEntriesTable)
      .innerJoin(
        recordingReleaseGroupsTable,
        eq(
          recordingReleaseGroupsTable.releaseGroupMbid,
          listEntriesTable.releaseGroupMbid,
        ),
      )
      .where(
        and(
          inArray(recordingReleaseGroupsTable.recordingMbid, mbids),
          sql`(${listEntriesTable.confidence} = 'exact' OR ${listEntriesTable.confirmed} = true)`,
        ),
      )
      .groupBy(recordingReleaseGroupsTable.recordingMbid),
    db
      .select({
        mbid: picksTable.mbid,
        n: sql<number>`count(distinct (${picksTable.pickerId}, coalesce(${picksTable.sourceUrl}, '')))::int`,
      })
      .from(picksTable)
      .where(inArray(picksTable.mbid, mbids))
      .groupBy(picksTable.mbid),
    user
      ? db
          .select({ mbid: libraryItemsTable.mbid, addedAt: libraryItemsTable.addedAt })
          .from(libraryItemsTable)
          .where(
            and(
              eq(libraryItemsTable.userId, user.id),
              inArray(libraryItemsTable.mbid, mbids),
            ),
          )
      : Promise.resolve([] as Array<{ mbid: string; addedAt: Date }>),
  ]);

  const claimMap = new Map(claims.map((r) => [r.mbid, r.n]));
  const seSet = new Set(seEpisodes.map((r) => r.mbid));
  const listMap = new Map(listRows.map((r) => [r.mbid, r.n]));
  const pickMap = new Map(pickRows.filter((r) => r.mbid != null).map((r) => [r.mbid!, r.n]));
  const libMap = new Map(libRows.map((r) => [r.mbid, r.addedAt]));

  return res.json({
    items: mbids.map((mbid) => ({
      mbid,
      artifactCount: (claimMap.get(mbid) ?? 0) + (seSet.has(mbid) ? 1 : 0),
      listCount: (listMap.get(mbid) ?? 0) + (pickMap.get(mbid) ?? 0),
      keptSince: libMap.get(mbid)?.toISOString() ?? null,
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/selectors — selector discovery for the SELECTORS tab.
// All active DJ/curated pickers with at least one logged spin, most recently
// heard first. Station context comes from the picker's linked shows.
// ---------------------------------------------------------------------------
/** 60s in-memory cache — both endpoints below aggregate over spins and are
 *  public/unauthenticated, so identical responses are reused briefly. */
const PLAYER_AGG_TTL_MS = 60_000;
let _selectorsCache: { builtAt: number; body: unknown } | null = null;
let _scheduleCache: { builtAt: number; body: unknown } | null = null;

router.get("/player/selectors", h(async (_req, res) => {
  if (_selectorsCache && Date.now() - _selectorsCache.builtAt < PLAYER_AGG_TTL_MS) {
    return res.json(_selectorsCache.body);
  }
  type Row = {
    id: number;
    name: string;
    handle: string;
    pickerType: string;
    stationName: string | null;
    stationSlug: string | null;
    recentSpinCount: number;
    lastPlayedAt: string | null;
  };
  const rows = await db.execute<Row>(sql`
    SELECT
      p.id,
      p.name,
      p.handle,
      p.picker_type                          AS "pickerType",
      MAX(st.name)                           AS "stationName",
      MAX(st.slug)                           AS "stationSlug",
      COUNT(sp.id) FILTER (WHERE sp.played_at >= NOW() - INTERVAL '30 days')::int
                                             AS "recentSpinCount",
      MAX(sp.played_at)                      AS "lastPlayedAt"
    FROM pickers p
    JOIN shows sh   ON sh.picker_id = p.id
    JOIN stations st ON st.id = sh.station_id AND st.hidden = false
    LEFT JOIN spins sp ON sp.show_id = sh.id
    WHERE p.active = true
      AND p.picker_type = 'dj'
      AND NOT EXISTS (SELECT 1 FROM selector_claims sc WHERE sc.picker_id = p.id AND sc.opted_out = true)
    GROUP BY p.id, p.name, p.handle, p.picker_type
    HAVING MAX(sp.played_at) IS NOT NULL
    ORDER BY MAX(sp.played_at) DESC
    LIMIT 120
  `);
  const body = {
    selectors: rows.rows.map((r) => ({
      ...r,
      lastPlayedAt: r.lastPlayedAt ? new Date(r.lastPlayedAt).toISOString() : null,
    })),
  };
  _selectorsCache = { builtAt: Date.now(), body };
  return res.json(body);
}));

// ---------------------------------------------------------------------------
// GET /api/player/selectors/:handle/runs — a selector's recent runs (any DJ
// picker, not just KEXP). Includes the station slug so the run drawer can
// open directly.
// ---------------------------------------------------------------------------
router.get("/player/selectors/:handle/runs", h(async (req, res) => {
  const handle = String(req.params["handle"] ?? "").trim();
  if (!handle) return res.status(404).json({ error: "Selector not found" });

  const [picker] = await db
    .select({ id: pickersTable.id, name: pickersTable.name, handle: pickersTable.handle })
    .from(pickersTable)
    .where(and(eq(pickersTable.handle, handle), eq(pickersTable.active, true)))
    .limit(1);
  if (!picker) return res.status(404).json({ error: "Selector not found" });

  if (await isPickerOptedOut(picker.id)) {
    return res.status(404).json({ error: "Selector not found" });
  }

  type RunRow = {
    runId: number;
    day: string;
    spinCount: number;
    startedAt: string;
    showName: string | null;
    djName: string | null;
    stationSlug: string;
    stationName: string;
  };
  const runRows = await db.execute<RunRow>(sql`
    SELECT
      MIN(sp.id)::int                                AS "runId",
      (DATE(sp.played_at AT TIME ZONE 'UTC'))::text  AS day,
      COUNT(*)::int                                  AS "spinCount",
      MIN(sp.played_at)                              AS "startedAt",
      sh.name                                        AS "showName",
      sh.dj_name                                     AS "djName",
      st.slug                                        AS "stationSlug",
      st.name                                        AS "stationName"
    FROM spins sp
    JOIN shows sh    ON sh.id = sp.show_id
    JOIN stations st ON st.id = sh.station_id
    WHERE sh.picker_id = ${picker.id}
    GROUP BY sh.id, sh.name, sh.dj_name, st.slug, st.name,
             DATE(sp.played_at AT TIME ZONE 'UTC')
    ORDER BY MIN(sp.played_at) DESC
    LIMIT 30
  `);
  return res.json({
    selector: { name: picker.name, handle: picker.handle },
    runs: runRows.rows.map((r) => ({
      runId: r.runId,
      day: r.day,
      spinCount: r.spinCount,
      startedAt: new Date(r.startedAt).toISOString(),
      show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
      station: { slug: r.stationSlug, name: r.stationName },
    })),
  });
}));

// ---------------------------------------------------------------------------
// GET /api/player/schedule — SCHEDULE tab read-model: shows live right now
// plus the rest of today's slate, across stations with a known timezone.
// Overnight slots (end <= start) match on their start day from start_time
// onward and on the next day before end_time (yesterday-DOW carryover) —
// the same canonical pattern as the crossing scorer and the spin stamper.
// ---------------------------------------------------------------------------
router.get("/player/schedule", h(async (_req, res) => {
  if (_scheduleCache && Date.now() - _scheduleCache.builtAt < PLAYER_AGG_TTL_MS) {
    return res.json(_scheduleCache.body);
  }
  type SlotRow = {
    stationSlug: string;
    stationName: string;
    showName: string;
    djName: string | null;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    ianaTimezone: string;
    isLive: boolean;
  };
  const rows = await db.execute<SlotRow>(sql`
    SELECT
      st.slug          AS "stationSlug",
      st.name          AS "stationName",
      ss.show_name     AS "showName",
      ss.dj_name       AS "djName",
      ss.day_of_week   AS "dayOfWeek",
      ss.start_time    AS "startTime",
      ss.end_time      AS "endTime",
      st.iana_timezone AS "ianaTimezone",
      (
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND (
            (ss.end_time > ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') <  ss.end_time)
            OR
            (ss.end_time < ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time)
          ))
        OR
        (ss.end_time < ss.start_time
          AND ss.day_of_week = TO_CHAR((NOW() - interval '1 day') AT TIME ZONE st.iana_timezone, 'Dy')
          AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') < ss.end_time)
      ) AS "isLive"
    FROM scraped_shows ss
    JOIN stations st ON st.id = ss.station_id
    WHERE st.hidden = false
      AND st.active = true
      AND st.iana_timezone IS NOT NULL
      AND (
        -- live now (any DOW form above) …
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND (
            (ss.end_time > ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') <  ss.end_time)
            OR
            (ss.end_time < ss.start_time
              AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') >= ss.start_time)
          ))
        OR
        (ss.end_time < ss.start_time
          AND ss.day_of_week = TO_CHAR((NOW() - interval '1 day') AT TIME ZONE st.iana_timezone, 'Dy')
          AND TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI') < ss.end_time)
        -- … or later today, station-local (zero-length slots excluded here too)
        OR
        (ss.day_of_week = TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'Dy')
          AND ss.start_time > TO_CHAR(NOW() AT TIME ZONE st.iana_timezone, 'HH24:MI')
          AND ss.end_time <> ss.start_time)
      )
    ORDER BY "isLive" DESC, ss.start_time ASC, st.name ASC
    LIMIT 200
  `);
  const body = {
    liveNow: rows.rows.filter((r) => r.isLive),
    upcomingToday: rows.rows.filter((r) => !r.isLive),
  };
  _scheduleCache = { builtAt: Date.now(), body };
  return res.json(body);
}));

export default router;
