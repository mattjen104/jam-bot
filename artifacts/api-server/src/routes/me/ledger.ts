import { Router, type IRouter } from "express";
import {
  db,
  loreUsersTable,
  listensTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  stationsTable,
  pickersTable,
  showsTable,
} from "@workspace/db";
import { eq, and, isNotNull, inArray, desc, sql } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * PATCH /api/me/preferences — update per-user preferences.
 * Currently accepts: { ledgerEnabled: boolean }
 * Extend this object as more preferences are added.
 */
router.patch("/me/preferences", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { ledgerEnabled } = req.body as { ledgerEnabled?: unknown };

  if (typeof ledgerEnabled !== "boolean") {
    return res.status(400).json({ error: "ledgerEnabled must be a boolean" });
  }

  await db
    .update(loreUsersTable)
    .set({ ledgerEnabled })
    .where(eq(loreUsersTable.id, user.id));

  return res.json({ ledgerEnabled });
}));

/**
 * GET /api/me/preferences — return current user preferences.
 */
router.get("/me/preferences", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  // Re-read from DB to get the authoritative value.
  const [row] = await db
    .select({ ledgerEnabled: loreUsersTable.ledgerEnabled })
    .from(loreUsersTable)
    .where(eq(loreUsersTable.id, user.id))
    .limit(1);
  return res.json({ ledgerEnabled: row?.ledgerEnabled ?? false });
}));

// ---------------------------------------------------------------------------
// Listening ledger
// ---------------------------------------------------------------------------

/**
 * Completion threshold: ≥ 70 % of track duration OR ≥ 4 minutes, whichever
 * is lower. We only flip `completed` when the threshold is met — never unflip.
 */
function isListenCompleted(
  msPlayed: number,
  durationMs: number | null | undefined,
): boolean {
  const MS_4_MINUTES = 4 * 60 * 1000;
  if (!durationMs || durationMs <= 0) {
    // No duration on record — use 4-minute absolute threshold.
    return msPlayed >= MS_4_MINUTES;
  }
  const threshold70pct = Math.floor(durationMs * 0.7);
  return msPlayed >= Math.min(threshold70pct, MS_4_MINUTES);
}

/**
 * POST /api/me/listens — record the start of a new listen.
 * Returns { id } so the client can PATCH progress later.
 * Silently no-ops (200, { id: null }) when ledgerEnabled = false.
 *
 * Body: {
 *   mbid?: string,
 *   spinId?: number,
 *   stationId?: number,
 *   pickerId?: number,
 *   showId?: number,
 *   context: string,
 *   outputService: string,
 *   startedAt?: string (ISO),
 * }
 */
router.post("/me/listens", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  // Silently no-op when the ledger is disabled.
  if (!user.ledgerEnabled) {
    return res.json({ id: null });
  }

  const {
    mbid,
    spinId,
    stationId,
    pickerId,
    showId,
    context,
    outputService,
    startedAt,
  } = req.body as {
    mbid?: string;
    spinId?: number;
    stationId?: number;
    pickerId?: number;
    showId?: number;
    context?: string;
    outputService?: string;
    startedAt?: string;
  };

  if (!context || !outputService) {
    return res.status(400).json({ error: "context and outputService are required" });
  }

  // Denormalise the primary release group at write time.
  let releaseGroupMbid: string | null = null;
  if (mbid) {
    const [rg] = await db
      .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
      .from(recordingReleaseGroupsTable)
      .where(
        and(
          eq(recordingReleaseGroupsTable.recordingMbid, mbid),
          eq(recordingReleaseGroupsTable.isPrimary, true),
        ),
      )
      .limit(1);
    releaseGroupMbid = rg?.releaseGroupMbid ?? null;
  }

  const [row] = await db
    .insert(listensTable)
    .values({
      userId: user.id,
      mbid: mbid ?? null,
      spinId: spinId ?? null,
      stationId: stationId ?? null,
      pickerId: pickerId ?? null,
      showId: showId ?? null,
      context,
      outputService,
      startedAt: startedAt ? new Date(startedAt) : new Date(),
      releaseGroupMbid,
    })
    .returning({ id: listensTable.id });

  return res.json({ id: row!.id });
}));

/**
 * PATCH /api/me/listens/:id — update msPlayed and flip completed when threshold met.
 * Only the owning userId may update. Intended as the progress-tick target —
 * callers should debounce to at most once per 10 seconds.
 * Body: { msPlayed: number }
 */
router.patch("/me/listens/:id", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const listenId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);
  if (isNaN(listenId)) return res.status(400).json({ error: "invalid listen id" });

  const { msPlayed } = req.body as { msPlayed?: unknown };
  if (typeof msPlayed !== "number" || msPlayed < 0) {
    return res.status(400).json({ error: "msPlayed must be a non-negative number" });
  }

  // Load the existing row to verify ownership and get current completed state.
  const [row] = await db
    .select({
      userId: listensTable.userId,
      mbid: listensTable.mbid,
      completed: listensTable.completed,
    })
    .from(listensTable)
    .where(eq(listensTable.id, listenId))
    .limit(1);

  if (!row) return res.status(404).json({ error: "listen not found" });
  if (row.userId !== user.id) return res.status(403).json({ error: "forbidden" });

  // Look up track duration for the completion threshold.
  let durationMs: number | null = null;
  if (row.mbid) {
    const [rec] = await db
      .select({ durationMs: recordingsTable.durationMs })
      .from(recordingsTable)
      .where(eq(recordingsTable.mbid, row.mbid))
      .limit(1);
    durationMs = rec?.durationMs ?? null;
  }

  // completed is sticky — once true, never unflagged.
  const completed = row.completed || isListenCompleted(msPlayed, durationMs);

  await db
    .update(listensTable)
    .set({ msPlayed, completed })
    .where(eq(listensTable.id, listenId));

  return res.json({ id: listenId, msPlayed, completed });
}));

/** Max listens per page. */
const LISTENS_PAGE_SIZE = 50;

/**
 * GET /api/me/listens — paginated listen history, newest first.
 * Query params:
 *   cursor      — ISO startedAt of the last item seen (keyset pagination)
 *   stationId   — filter by station id
 *   context     — filter by context (broadcast|ride|replay|library)
 *   completed   — filter by completed (true|false)
 *   limit       — page size (max 100)
 */
router.get("/me/listens", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const cursor = typeof req.query["cursor"] === "string" ? req.query["cursor"].trim() : null;
  const limit = Math.min(
    parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10) || LISTENS_PAGE_SIZE,
    100,
  );
  const stationIdRaw = typeof req.query["stationId"] === "string" ? parseInt(req.query["stationId"], 10) : null;
  const contextFilter = typeof req.query["context"] === "string" ? req.query["context"].trim() : null;
  const completedFilter = typeof req.query["completed"] === "string" ? req.query["completed"] : null;

  const conditions = [eq(listensTable.userId, user.id)];

  if (stationIdRaw && !isNaN(stationIdRaw)) {
    conditions.push(eq(listensTable.stationId, stationIdRaw));
  }
  if (contextFilter) {
    conditions.push(eq(listensTable.context, contextFilter));
  }
  if (completedFilter === "true") {
    conditions.push(eq(listensTable.completed, true));
  } else if (completedFilter === "false") {
    conditions.push(eq(listensTable.completed, false));
  }
  if (cursor) {
    conditions.push(sql`${listensTable.startedAt} < ${cursor}::timestamptz`);
  }

  const rows = await db
    .select({
      id: listensTable.id,
      mbid: listensTable.mbid,
      spinId: listensTable.spinId,
      stationId: listensTable.stationId,
      pickerId: listensTable.pickerId,
      showId: listensTable.showId,
      context: listensTable.context,
      outputService: listensTable.outputService,
      startedAt: listensTable.startedAt,
      msPlayed: listensTable.msPlayed,
      completed: listensTable.completed,
      releaseGroupMbid: listensTable.releaseGroupMbid,
      recordingTitle: recordingsTable.title,
      recordingArtist: recordingsTable.artist,
      stationName: stationsTable.name,
      stationSlug: stationsTable.slug,
      pickerName: pickersTable.name,
      showName: showsTable.name,
    })
    .from(listensTable)
    .leftJoin(recordingsTable, eq(listensTable.mbid, recordingsTable.mbid))
    .leftJoin(stationsTable, eq(listensTable.stationId, stationsTable.id))
    .leftJoin(pickersTable, eq(listensTable.pickerId, pickersTable.id))
    .leftJoin(showsTable, eq(listensTable.showId, showsTable.id))
    .where(and(...conditions))
    .orderBy(desc(listensTable.startedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return res.json({
    items: items.map((r) => ({
      id: r.id,
      mbid: r.mbid,
      spinId: r.spinId,
      stationId: r.stationId,
      pickerId: r.pickerId,
      showId: r.showId,
      context: r.context,
      outputService: r.outputService,
      startedAt: r.startedAt.toISOString(),
      msPlayed: r.msPlayed,
      completed: r.completed,
      releaseGroupMbid: r.releaseGroupMbid,
      recording: r.recordingTitle ? { title: r.recordingTitle, artist: r.recordingArtist } : null,
      station: r.stationName ? { name: r.stationName, slug: r.stationSlug } : null,
      picker: r.pickerName ? { name: r.pickerName } : null,
      show: r.showName ? { name: r.showName } : null,
    })),
    nextCursor: !hasMore || !last ? null : last.startedAt.toISOString(),
  });
}));

/**
 * DELETE /api/me/listens/:id — delete one listen row belonging to the authenticated user.
 */
router.delete("/me/listens/:id", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const listenId = parseInt(typeof req.params.id === "string" ? req.params.id : "", 10);
  if (isNaN(listenId)) return res.status(400).json({ error: "invalid listen id" });

  const result = await db
    .delete(listensTable)
    .where(and(eq(listensTable.id, listenId), eq(listensTable.userId, user.id)))
    .returning({ id: listensTable.id });

  if (result.length === 0) return res.status(404).json({ error: "listen not found" });
  return res.status(204).end();
}));

/**
 * DELETE /api/me/listens — delete all listen rows for the authenticated user.
 * Requires ?confirm=true to prevent accidental wipes.
 */
router.delete("/me/listens", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (req.query["confirm"] !== "true") {
    return res.status(400).json({ error: "Pass ?confirm=true to delete all listens" });
  }

  await db
    .delete(listensTable)
    .where(eq(listensTable.userId, user.id));

  return res.status(204).end();
}));

/**
 * GET /api/me/albums/completed — album completion summary.
 * For each release group heard (any listen with a releaseGroupMbid), returns:
 *   releaseGroupMbid, title, artistName, totalTracks, heardTracks (completed only).
 * No new table — derived entirely from listens + recording_release_groups.
 */
router.get("/me/albums/completed", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  // Step 1: distinct release groups the user has heard (any completion state).
  const heardRgs = await db
    .selectDistinct({ releaseGroupMbid: listensTable.releaseGroupMbid })
    .from(listensTable)
    .where(
      and(
        eq(listensTable.userId, user.id),
        isNotNull(listensTable.releaseGroupMbid),
      ),
    );

  if (heardRgs.length === 0) return res.json({ albums: [] });

  const rgMbids = heardRgs.map((r) => r.releaseGroupMbid!);

  // Step 2: total track count per release group (all recordings linked to it).
  const totalsByRg = await db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      title: recordingReleaseGroupsTable.title,
      total: sql<number>`count(*)::int`,
    })
    .from(recordingReleaseGroupsTable)
    .where(inArray(recordingReleaseGroupsTable.releaseGroupMbid, rgMbids))
    .groupBy(
      recordingReleaseGroupsTable.releaseGroupMbid,
      recordingReleaseGroupsTable.title,
    );

  // Step 3: distinct completed MBIDs per release group from the user's listens.
  const heardByRg = await db
    .select({
      releaseGroupMbid: listensTable.releaseGroupMbid,
      heardTracks: sql<number>`count(distinct ${listensTable.mbid})::int`,
    })
    .from(listensTable)
    .where(
      and(
        eq(listensTable.userId, user.id),
        eq(listensTable.completed, true),
        isNotNull(listensTable.releaseGroupMbid),
        isNotNull(listensTable.mbid),
        inArray(listensTable.releaseGroupMbid, rgMbids),
      ),
    )
    .groupBy(listensTable.releaseGroupMbid);

  // Step 4: join artist name from a representative recording in each RG.
  const artistByRg = await db
    .select({
      releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid,
      artistName: recordingsTable.artist,
    })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      recordingsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid),
    )
    .where(
      and(
        inArray(recordingReleaseGroupsTable.releaseGroupMbid, rgMbids),
        eq(recordingReleaseGroupsTable.isPrimary, true),
      ),
    )
    .groupBy(
      recordingReleaseGroupsTable.releaseGroupMbid,
      recordingsTable.artist,
    )
    .limit(rgMbids.length * 2); // generous bound; we pick the first per RG below

  const artistMap = new Map<string, string>();
  for (const r of artistByRg) {
    if (!artistMap.has(r.releaseGroupMbid)) {
      artistMap.set(r.releaseGroupMbid, r.artistName);
    }
  }

  const heardMap = new Map(heardByRg.map((r) => [r.releaseGroupMbid, r.heardTracks]));

  const albums = totalsByRg.map((rg) => ({
    releaseGroupMbid: rg.releaseGroupMbid,
    title: rg.title ?? null,
    artistName: artistMap.get(rg.releaseGroupMbid) ?? null,
    totalTracks: rg.total,
    heardTracks: heardMap.get(rg.releaseGroupMbid) ?? 0,
  }));

  // Sort by heardTracks desc, then totalTracks asc (most complete first).
  albums.sort((a, b) => b.heardTracks - a.heardTracks || a.totalTracks - b.totalTracks);

  return res.json({ albums });
}));

export default router;
