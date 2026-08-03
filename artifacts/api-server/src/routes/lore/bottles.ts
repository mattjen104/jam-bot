/**
 * Song Bottles API routes.
 *
 * Mounted before loreRouter so /api/songs/* doesn't fall through to the admin
 * catch-all, and /api/stations/social/presence sits before :slug wildcards.
 *
 * Routes:
 *   GET  /api/songs/:mbid/bottles       — up to 3 surviving bottles + archivedCount
 *   POST /api/songs/:mbid/bottles       — seal and send a new bottle
 *   GET  /api/stations/social/presence  — active session counts per station
 *   GET  /api/stations/:id/bottles/stream — SSE stream of incoming bottles + presence
 */
import { Router, type IRouter, type Response } from "express";
import { eq, and, gt, isNull, sql, inArray, count as drizzleCount } from "drizzle-orm";
import {
  db,
  songBottlesTable,
  loreUsersTable,
  listenSessionsTable,
  recordingsTable,
} from "@workspace/db";
import { getUserFromSession } from "../../lore/userSession.js";
import { deviceHandle } from "../../lore/socialHandle.js";
import { spinEvents, type SpinChangedEvent } from "../../lore/resolve.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// SSE registry — one Set<Response> per stationId
// ---------------------------------------------------------------------------
const bottleSseClients = new Map<number, Set<Response>>();

function addSseClient(stationId: number, res: Response): void {
  let set = bottleSseClients.get(stationId);
  if (!set) { set = new Set(); bottleSseClients.set(stationId, set); }
  set.add(res);
}

function removeSseClient(stationId: number, res: Response): void {
  bottleSseClients.get(stationId)?.delete(res);
}

function pushSseEvent(stationId: number, event: string, data: unknown): void {
  const clients = bottleSseClients.get(stationId);
  if (!clients || clients.size === 0) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    if (!res.writableEnded) res.write(payload);
  }
}

// ---------------------------------------------------------------------------
// Spin-event hook — decrement bottles and push to SSE subscribers
// ---------------------------------------------------------------------------
spinEvents.on("spin-changed", async (ev: SpinChangedEvent) => {
  if (!ev.mbid) return;
  try {
    // Fetch surviving bottles BEFORE decrement (pre-decrement state is
    // what gets delivered to the listeners currently tuned in).
    const surviving = await db
      .select()
      .from(songBottlesTable)
      .where(
        and(
          eq(songBottlesTable.mbid, ev.mbid),
          gt(songBottlesTable.playsRemaining, 0),
          isNull(songBottlesTable.bodyArchivedAt),
        ),
      );

    if (surviving.length === 0) return;

    // Decrement plays_remaining for all surviving bottles atomically.
    // Null body + set body_archived_at on any that just reached 0.
    await db.transaction(async (tx) => {
      const ids = surviving.map((b) => b.id);
      await tx.execute(sql`
        UPDATE song_bottles
        SET plays_remaining = plays_remaining - 1,
            body            = CASE WHEN plays_remaining - 1 <= 0 THEN NULL ELSE body END,
            body_archived_at = CASE WHEN plays_remaining - 1 <= 0 THEN now() ELSE body_archived_at END
        WHERE id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::integer[])
      `);
    });

    // Push the pre-decrement bottles to SSE clients for this station.
    const bottlesPayload = surviving
      .filter((b) => b.body != null)
      .map((b) => ({
        id: b.id,
        mbid: b.mbid,
        handle: b.handle,
        avatar: b.avatar,
        body: b.body,
        progressMs: b.progressMs,
        playsRemaining: b.playsRemaining,
        createdAt: b.createdAt.toISOString(),
      }));
    if (bottlesPayload.length > 0) {
      pushSseEvent(ev.stationId, "bottles", { bottles: bottlesPayload });
    }
  } catch (err) {
    console.error("[bottles] spin-event decrement failed", ev.mbid, err);
  }
});

// ---------------------------------------------------------------------------
// GET /api/songs/:mbid/bottles
// ---------------------------------------------------------------------------
router.get("/songs/:mbid/bottles", h(async (req, res) => {
  const { mbid } = req.params as { mbid: string };
  if (!mbid) return res.status(400).json({ error: "mbid required" });

  // Check recording exists
  const [rec] = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!rec) return res.status(404).json({ error: "recording not found" });

  // Surviving bottles — up to 3, most recent first
  const surviving = await db
    .select({
      id: songBottlesTable.id,
      mbid: songBottlesTable.mbid,
      handle: songBottlesTable.handle,
      avatar: songBottlesTable.avatar,
      body: songBottlesTable.body,
      progressMs: songBottlesTable.progressMs,
      playsRemaining: songBottlesTable.playsRemaining,
      createdAt: songBottlesTable.createdAt,
      stationId: songBottlesTable.stationId,
    })
    .from(songBottlesTable)
    .where(
      and(
        eq(songBottlesTable.mbid, mbid),
        gt(songBottlesTable.playsRemaining, 0),
        isNull(songBottlesTable.bodyArchivedAt),
      ),
    )
    .orderBy(sql`${songBottlesTable.createdAt} DESC`)
    .limit(3);

  // Archived count — rows where body has been nulled
  const [countRow] = await db
    .select({ n: drizzleCount() })
    .from(songBottlesTable)
    .where(
      and(
        eq(songBottlesTable.mbid, mbid),
        sql`${songBottlesTable.bodyArchivedAt} IS NOT NULL`,
      ),
    );
  const archivedCount = Number(countRow?.n ?? 0);

  return res.json({
    bottles: surviving.map((b) => ({
      ...b,
      createdAt: b.createdAt.toISOString(),
    })),
    archivedCount,
  });
}));

// ---------------------------------------------------------------------------
// POST /api/songs/:mbid/bottles
// ---------------------------------------------------------------------------
router.post("/songs/:mbid/bottles", h(async (req, res) => {
  const { mbid } = req.params as { mbid: string };
  if (!mbid) return res.status(400).json({ error: "mbid required" });

  const body = req.body as {
    body?: unknown;
    avatar?: unknown;
    stationId?: unknown;
    progress_ms?: unknown;
  };

  const noteBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!noteBody || noteBody.length > 280) {
    return res.status(400).json({ error: "body must be 1–280 characters" });
  }
  const avatar = typeof body.avatar === "string" ? body.avatar.trim() : "";
  if (!avatar) return res.status(400).json({ error: "avatar required" });

  const stationId = typeof body.stationId === "number" && Number.isInteger(body.stationId)
    ? body.stationId
    : null;
  if (!stationId) return res.status(400).json({ error: "stationId required" });

  const progressMs = typeof body.progress_ms === "number" ? body.progress_ms : null;

  // Check recording exists
  const [rec] = await db
    .select({ mbid: recordingsTable.mbid })
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  if (!rec) return res.status(404).json({ error: "recording not found" });

  // Resolve user from session (auto-provisions anon user)
  const user = await getUserFromSession(req);
  if (!user) return res.status(401).json({ error: "session required" });

  // Rate limit: one bottle per (user, mbid) per calendar day (UTC).
  // Using a day window rather than plays_remaining so the guard applies even
  // if a previous bottle has already been archived (played out).
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [existing] = await db
    .select({ id: songBottlesTable.id })
    .from(songBottlesTable)
    .where(
      and(
        eq(songBottlesTable.userId, user.id),
        eq(songBottlesTable.mbid, mbid),
        sql`${songBottlesTable.createdAt} >= ${startOfDay}`,
      ),
    )
    .limit(1);
  if (existing) return res.status(409).json({ error: "already sealed a bottle for this track today" });

  // Upsert avatar on lore_users if they don't have one yet
  await db
    .update(loreUsersTable)
    .set({ avatar })
    .where(
      and(
        eq(loreUsersTable.id, user.id),
        isNull(loreUsersTable.avatar),
      ),
    );

  const handle = deviceHandle(user.deviceKey);

  const [inserted] = await db
    .insert(songBottlesTable)
    .values({
      mbid,
      stationId,
      userId: user.id,
      handle,
      avatar,
      body: noteBody,
      progressMs,
    })
    .returning();

  if (!inserted) return res.status(500).json({ error: "insert failed" });

  return res.status(201).json({
    ...inserted,
    createdAt: inserted.createdAt.toISOString(),
    bodyArchivedAt: inserted.bodyArchivedAt?.toISOString() ?? null,
  });
}));

// ---------------------------------------------------------------------------
// GET /api/stations/social/presence?ids=1,2,3
// ---------------------------------------------------------------------------
router.get("/stations/social/presence", h(async (req, res) => {
  const raw = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = raw
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) return res.json({ presence: {}, avatars: {} });

  // Sessions with a heartbeat within the last 3 minutes
  const threshold = new Date(Date.now() - 3 * 60_000);
  const rows = await db
    .select({
      stationId: listenSessionsTable.stationId,
      userId: listenSessionsTable.userId,
      artworkUrl: loreUsersTable.avatarArtworkUrl,
      albumTitle: loreUsersTable.avatarAlbumTitle,
      artist: loreUsersTable.avatarArtist,
    })
    .from(listenSessionsTable)
    .leftJoin(loreUsersTable, eq(listenSessionsTable.userId, loreUsersTable.id))
    .where(
      and(
        inArray(listenSessionsTable.stationId, ids),
        isNull(listenSessionsTable.endedAt),
        sql`${listenSessionsTable.lastHeartbeatAt} >= ${threshold}`,
      ),
    )
    ;

  const byStation = new Map<number, Map<number, { artworkUrl: string; albumTitle: string; artist: string }>>();
  for (const row of rows) {
    let users = byStation.get(row.stationId);
    if (!users) {
      users = new Map();
      byStation.set(row.stationId, users);
    }
    if (
      row.artworkUrl &&
      row.albumTitle &&
      row.artist &&
      /^https?:\/\//i.test(row.artworkUrl)
    ) {
      users.set(row.userId, {
        artworkUrl: row.artworkUrl,
        albumTitle: row.albumTitle,
        artist: row.artist,
      });
    } else if (!users.has(row.userId)) {
      users.set(row.userId, { artworkUrl: "", albumTitle: "", artist: "" });
    }
  }
  const presence: Record<number, number> = {};
  const avatars: Record<number, Array<{ artworkUrl: string; albumTitle: string; artist: string }>> = {};
  for (const [stationId, users] of byStation) {
    const count = users.size;
    presence[stationId] = count;
    // Covers are intentionally withheld at the privacy threshold. The
    // response contains no user ids or handles, only anonymous cover tokens.
    if (count < 10) {
      avatars[stationId] = [...users.values()]
        .filter((avatar) => avatar.artworkUrl)
        .slice(0, 3);
    }
  }
  return res.json({ presence, avatars });
}));

// ---------------------------------------------------------------------------
// GET /api/stations/:id/bottles/stream — SSE
// ---------------------------------------------------------------------------
router.get("/stations/:id/bottles/stream", (req, res) => {
  const rawId = typeof req.params.id === "string" ? req.params.id : "";
  const stationId = parseInt(rawId, 10);
  if (isNaN(stationId) || stationId <= 0) {
    res.status(400).json({ error: "invalid station id" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(":connected\n\n");

  addSseClient(stationId, res);

  // Keep-alive comment every 15 s
  const ping = setInterval(() => {
    if (!res.writableEnded) res.write(":ping\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(ping);
    removeSseClient(stationId, res);
  });
});

export default router;
