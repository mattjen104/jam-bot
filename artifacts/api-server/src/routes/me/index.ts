import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  serviceConnectionsTable,
  libraryItemsTable,
  libraryImportJobsTable,
  keepTargetsTable,
  recordingsTable,
  picksTable,
  pickersTable,
  spinsTable,
  stationsTable,
  showsTable,
  type LoreUser,
  type LibraryItemProvenance,
} from "@workspace/db";
import { eq, and, isNotNull, inArray, ne, desc, asc, sql } from "drizzle-orm";
import {
  getUserFromSession,
  sidFromRequest,
} from "../../lore/userSession.js";
import {
  getConnector,
  getFreshServiceToken,
  refreshServiceToken,
} from "../../lore/serviceConnector.js";
import { encryptToken, decryptToken } from "../../lore/tokenCrypto.js";
import { resolveToMbid } from "../../lore/resolve.js";
import { h } from "../../middlewares/asyncHandler.js";
import { spinDayExpr } from "../../lore/runs.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SID_COOKIE = "lore_sid";
const STATE_COOKIE = "lore_me_spotify_state";
const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 min
const APP_RETURN_PATH = process.env.LORE_APP_URL ?? "/lore/";
/** Max MBIDs per batch keep-status check. */
const KEEP_BATCH_MAX = 50;
/** Max library page size. */
const LIBRARY_PAGE_SIZE = 50;
/** Delay between resolveToMbid calls in the import worker (1.1 s ≥ MB 1 req/sec). */
const IMPORT_RESOLVE_DELAY_MS = 1100;

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/** Extend Request with the resolved user attached by requireUser. */
export interface AuthedRequest extends Request {
  loreUser: LoreUser;
}

/**
 * Middleware: reads `lore_sid`, resolves the `lore_users` row, attaches it as
 * `req.loreUser`. Returns 401 when no session or no user row exists.
 */
async function requireUserMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await getUserFromSession(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    (req as AuthedRequest).loreUser = user;
    next();
  } catch (err) {
    next(err);
  }
}

router.use("/me", requireUserMiddleware);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

function meCallbackUri(): string {
  const explicit = process.env.SPOTIFY_LIBRARY_REDIRECT_URI;
  if (explicit) return explicit;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) throw new Error("Cannot derive redirect URI: set SPOTIFY_LIBRARY_REDIRECT_URI");
  return `https://${domain}/api/me/connect/spotify/callback`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Load a fresh access token for a service_connections row, refreshing if needed.
 *  Handles encrypt/decrypt transparently — callers receive a plaintext token. */
async function getFreshToken(
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<string | null> {
  const plainAccess = decryptToken(conn.accessToken);
  if (conn.expiresAt.getTime() > Date.now()) return plainAccess;
  try {
    const plainRefresh = decryptToken(conn.refreshToken);
    const refreshed = await refreshServiceToken(plainRefresh);
    await db
      .update(serviceConnectionsTable)
      .set({
        accessToken: encryptToken(refreshed.accessToken),
        expiresAt: refreshed.expiresAt,
      })
      .where(eq(serviceConnectionsTable.id, conn.id));
    return refreshed.accessToken;
  } catch (err) {
    console.error("[me] service token refresh failed", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connection endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/connections — list service connections + capabilities.
 * Shape mirrors what the frontend "Connect" panel needs.
 */
router.get("/me/connections", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rows = await db
    .select()
    .from(serviceConnectionsTable)
    .where(eq(serviceConnectionsTable.userId, user.id));

  return res.json({
    connections: rows.map((r) => ({
      service: r.service,
      canWrite: r.canWrite,
      connectedAt: r.connectedAt.toISOString(),
      lastImportAt: r.lastImportAt ? r.lastImportAt.toISOString() : null,
    })),
  });
}));

/**
 * POST /api/me/connect/spotify/start — return OAuth URL for the library
 * permission dance (separate from the playback OAuth).
 */
router.post("/me/connect/spotify/start", h(async (req, res) => {
  const connector = getConnector("spotify");
  if (!connector) return res.status(503).json({ error: "Spotify connector not available" });

  const state = randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOpts(STATE_MAX_AGE_MS));

  const url = connector.authStart(state, meCallbackUri());
  return res.json({ url });
}));

/**
 * GET /api/me/connect/spotify/callback — OAuth callback for library connect.
 * Stores tokens in service_connections, enables keep_targets.
 */
router.get("/me/connect/spotify/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const expectedState = cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (error) {
    res.redirect(`${APP_RETURN_PATH}?library=denied`);
    return;
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    res.redirect(`${APP_RETURN_PATH}?library=error`);
    return;
  }

  const sid = sidFromRequest(req);
  if (!sid) {
    res.redirect(`${APP_RETURN_PATH}?library=error&reason=no_session`);
    return;
  }

  const user = await getUserFromSession(req);
  if (!user) {
    res.redirect(`${APP_RETURN_PATH}?library=error&reason=no_user`);
    return;
  }

  try {
    const connector = getConnector("spotify");
    if (!connector) throw new Error("connector not available");

    const tokens = await connector.authCallback(code, meCallbackUri());
    const encAccessToken = encryptToken(tokens.accessToken);
    const encRefreshToken = encryptToken(tokens.refreshToken);

    await db
      .insert(serviceConnectionsTable)
      .values({
        userId: user.id,
        service: "spotify",
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        canWrite: tokens.canWrite,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [serviceConnectionsTable.userId, serviceConnectionsTable.service],
        set: {
          accessToken: encAccessToken,
          refreshToken: encRefreshToken,
          expiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          canWrite: tokens.canWrite,
          connectedAt: new Date(),
        },
      });

    // Enable keep mirroring to Spotify by default on first connect.
    await db
      .insert(keepTargetsTable)
      .values({ userId: user.id, service: "spotify", enabled: true })
      .onConflictDoNothing();

    res.redirect(`${APP_RETURN_PATH}?library=connected`);
  } catch (err) {
    console.error("[me] library OAuth callback failed", err);
    res.redirect(`${APP_RETURN_PATH}?library=error`);
  }
});

// ---------------------------------------------------------------------------
// Library import
// ---------------------------------------------------------------------------

/**
 * POST /api/me/library/import?service=spotify — kick off a background import.
 * Creates a `library_import_jobs` row and starts the worker asynchronously.
 */
router.post("/me/library/import", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const service = typeof req.query["service"] === "string" ? req.query["service"].trim() : "";
  if (!service) return res.status(400).json({ error: "service query param is required" });

  const connector = getConnector(service);
  if (!connector) return res.status(400).json({ error: `Unknown service: ${service}` });

  const [conn] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(
      and(
        eq(serviceConnectionsTable.userId, user.id),
        eq(serviceConnectionsTable.service, service),
      ),
    )
    .limit(1);

  if (!conn) {
    return res.status(400).json({ error: `No ${service} connection found; connect first.` });
  }

  const [job] = await db
    .insert(libraryImportJobsTable)
    .values({
      userId: user.id,
      service,
      status: "pending",
      total: 0,
      resolved: 0,
      startedAt: new Date(),
    })
    .returning();

  // Kick the worker off the hot path.
  setImmediate(() => runImportWorker(job!.id, user.id, service, conn));

  return res.status(202).json({ jobId: job!.id, status: "pending" });
}));

/**
 * GET /api/me/library/import/:jobId — poll import progress.
 */
router.get("/me/library/import/:jobId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawJobId = req.params.jobId;
  const jobId = parseInt(typeof rawJobId === "string" ? rawJobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });

  const [job] = await db
    .select()
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.id, jobId),
        eq(libraryImportJobsTable.userId, user.id),
      ),
    )
    .limit(1);

  if (!job) return res.status(404).json({ error: "Job not found" });

  return res.json({
    jobId: job.id,
    service: job.service,
    status: job.status,
    total: job.total,
    resolved: job.resolved,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
  });
}));

// ---------------------------------------------------------------------------
// Import worker (runs off the hot path via setImmediate)
// ---------------------------------------------------------------------------

async function runImportWorker(
  jobId: number,
  userId: number,
  service: string,
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<void> {
  try {
    await db
      .update(libraryImportJobsTable)
      .set({ status: "running" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const accessToken = await getFreshToken(conn);
    if (!accessToken) {
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: "Token refresh failed", finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, jobId));
      return;
    }

    const connector = getConnector(service);
    if (!connector) throw new Error(`connector '${service}' not found`);

    let total = 0;
    let resolved = 0;

    for await (const raw of connector.importLibrary(accessToken)) {
      total++;

      // Resolve raw artist+title to an MBID, honoring the MB 1 req/sec budget.
      const resolution = await resolveToMbid(
        raw.artist,
        raw.title,
        raw.durationMs,
        raw.isrc ? { isrc: raw.isrc } : undefined,
      );

      if (resolution.mbid) {
        const provenance: LibraryItemProvenance = { kind: "import", service };
        await db
          .insert(libraryItemsTable)
          .values({
            userId,
            mbid: resolution.mbid,
            provenance,
            addedAt: new Date(),
          })
          .onConflictDoNothing();
        resolved++;
      }

      // Update progress every 10 items so polling shows progress.
      if (total % 10 === 0) {
        await db
          .update(libraryImportJobsTable)
          .set({ total, resolved })
          .where(eq(libraryImportJobsTable.id, jobId));
      }

      // Respect MusicBrainz 1 req/sec budget.
      await sleep(IMPORT_RESOLVE_DELAY_MS);
    }

    // Update service_connections.lastImportAt.
    await db
      .update(serviceConnectionsTable)
      .set({ lastImportAt: new Date() })
      .where(eq(serviceConnectionsTable.id, conn.id));

    await db
      .update(libraryImportJobsTable)
      .set({ status: "done", total, resolved, finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId));

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[me] import worker job=${jobId} failed`, err);
    await db
      .update(libraryImportJobsTable)
      .set({ status: "error", error: message.slice(0, 500), finishedAt: new Date() })
      .where(eq(libraryImportJobsTable.id, jobId))
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Library endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/library — paginated list of kept + imported recordings.
 * Newest first.  Pass ?cursor=<addedAt ISO> to page.
 */
router.get("/me/library", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const cursor =
    typeof req.query["cursor"] === "string" ? req.query["cursor"].trim() : null;
  const limit = Math.min(
    parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10) || LIBRARY_PAGE_SIZE,
    100,
  );

  const rows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
    })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .where(
      cursor
        ? and(
            eq(libraryItemsTable.userId, user.id),
            sql`${libraryItemsTable.addedAt} < ${cursor}::timestamptz`,
          )
        : eq(libraryItemsTable.userId, user.id),
    )
    .orderBy(desc(libraryItemsTable.addedAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  return res.json({
    items: items.map((r) => ({
      mbid: r.mbid,
      provenance: r.provenance,
      addedAt: r.addedAt.toISOString(),
      recording: r.title
        ? { title: r.title, artist: r.artist, artworkUrl: r.artworkUrl ?? null }
        : null,
    })),
    nextCursor: hasMore ? items[items.length - 1]?.addedAt.toISOString() : null,
  });
}));

// ---------------------------------------------------------------------------
// Keep endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/me/keep — upsert a recording into library_items and optionally
 * mirror to enabled streaming services.
 * Body: { mbid: string, provenance?: object }
 */
router.post("/me/keep", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { mbid, provenance: provenanceOverride } = req.body as {
    mbid?: string;
    provenance?: Partial<LibraryItemProvenance>;
  };

  if (!mbid || typeof mbid !== "string") {
    return res.status(400).json({ error: "mbid is required" });
  }

  // The recording must already be on the spine.
  const [recording] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);

  if (!recording) {
    return res.status(404).json({ error: "Recording not on the spine" });
  }

  const provenance: LibraryItemProvenance = {
    kind: "keep",
    ...provenanceOverride,
  };

  await db
    .insert(libraryItemsTable)
    .values({ userId: user.id, mbid, provenance, addedAt: new Date() })
    .onConflictDoUpdate({
      target: [libraryItemsTable.userId, libraryItemsTable.mbid],
      set: { provenance, addedAt: new Date() },
    });

  // Mirror to enabled service connectors.
  const enabledTargets = await db
    .select()
    .from(keepTargetsTable)
    .where(and(eq(keepTargetsTable.userId, user.id), eq(keepTargetsTable.enabled, true)));

  const mirrors: Array<{ service: string; ok: boolean; linkOut?: string }> = [];

  for (const target of enabledTargets) {
    const [conn] = await db
      .select()
      .from(serviceConnectionsTable)
      .where(
        and(
          eq(serviceConnectionsTable.userId, user.id),
          eq(serviceConnectionsTable.service, target.service),
        ),
      )
      .limit(1);

    if (!conn) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    if (!conn.canWrite) {
      const q = encodeURIComponent(`${recording.artist} ${recording.title}`);
      mirrors.push({
        service: target.service,
        ok: false,
        linkOut: `https://open.spotify.com/search/${q}`,
      });
      continue;
    }

    const accessToken = await getFreshToken(conn);
    if (!accessToken) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    const connector = getConnector(target.service);
    if (!connector) {
      mirrors.push({ service: target.service, ok: false });
      continue;
    }

    const result = await connector.addToLibrary(accessToken, recording);
    mirrors.push({ service: target.service, ...result });
  }

  return res.json({ keptToLore: true, mirrors });
}));

/**
 * DELETE /api/me/keep/:mbid — remove a recording from library_items only.
 * Never touches the streaming service library.
 */
router.delete("/me/keep/:mbid", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const mbid = typeof req.params.mbid === "string" ? req.params.mbid : "";
  if (!mbid) return res.status(400).json({ error: "mbid is required" });

  await db
    .delete(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        eq(libraryItemsTable.mbid, mbid),
      ),
    );

  return res.status(204).end();
}));

/**
 * GET /api/me/keep/status?mbids=a,b,c — batch presence check.
 * Returns the subset of the given MBIDs that the user has kept.
 * Pattern mirrors GET /picks/contains.
 */
router.get("/me/keep/status", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const raw = typeof req.query["mbids"] === "string" ? req.query["mbids"] : "";
  if (!raw) return res.status(400).json({ error: "mbids is required" });

  const mbids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, KEEP_BATCH_MAX);

  if (mbids.length === 0) return res.json({ kept: [] });

  const rows = await db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        inArray(libraryItemsTable.mbid, mbids),
      ),
    );

  return res.json({ kept: rows.map((r) => r.mbid) });
}));

// ---------------------------------------------------------------------------
// Taste overlap endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/overlaps/pickers — pickers ranked by exact-MBID intersection
 * with the user's library_items.  Shape mirrors station→picker overlaps.
 */
router.get("/me/overlaps/pickers", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userLib = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const sharedExpr = sql<number>`count(distinct ${picksTable.mbid})::int`;

  const rows = await db
    .select({
      name: pickersTable.name,
      handle: pickersTable.handle,
      pickerType: pickersTable.pickerType,
      trustTier: pickersTable.trustTier,
      sharedCount: sharedExpr,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        ne(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, userLib),
      ),
    )
    .groupBy(
      pickersTable.id,
      pickersTable.name,
      pickersTable.handle,
      pickersTable.pickerType,
      pickersTable.trustTier,
    )
    .orderBy(
      sql`count(distinct ${picksTable.mbid}) desc`,
      asc(pickersTable.trustTier),
      asc(pickersTable.name),
    )
    .limit(20);

  return res.json({
    items: rows.map((r) => ({
      picker: {
        name: r.name,
        handle: r.handle,
        pickerType: r.pickerType,
        trustTier: r.trustTier,
      },
      sharedCount: r.sharedCount,
    })),
  });
}));

/**
 * GET /api/me/overlaps/stations — stations ranked by shared spins with the
 * user's library_items.
 */
router.get("/me/overlaps/stations", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userLib = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const sharedExpr = sql<number>`count(distinct ${spinsTable.mbid})::int`;

  const rows = await db
    .select({
      slug: stationsTable.slug,
      name: stationsTable.name,
      stationClass: stationsTable.stationClass,
      sharedCount: sharedExpr,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .where(
      and(
        isNotNull(spinsTable.mbid),
        inArray(spinsTable.mbid, userLib),
      ),
    )
    .groupBy(stationsTable.id, stationsTable.slug, stationsTable.name, stationsTable.stationClass)
    .orderBy(
      sql`count(distinct ${spinsTable.mbid}) desc`,
      asc(stationsTable.name),
    )
    .limit(20);

  return res.json({
    items: rows.map((r) => ({
      station: {
        slug: r.slug,
        name: r.name,
        stationClass: r.stationClass,
      },
      sharedCount: r.sharedCount,
    })),
  });
}));

/**
 * GET /api/me/overlaps/runs — station broadcast runs with `owned` (MBIDs in
 * user's library) and `discover` (resolved MBIDs NOT in library), ranked by
 * owned desc, then discover desc.
 */
router.get("/me/overlaps/runs", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const userMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  const rows = await db
    .select({
      runId: sql<number>`min(${spinsTable.id})`,
      day: spinDayExpr,
      stationSlug: stationsTable.slug,
      stationName: stationsTable.name,
      stationClass: stationsTable.stationClass,
      showName: showsTable.name,
      djName: showsTable.djName,
      owned: sql<number>`count(*) filter (where ${spinsTable.mbid} in (${userMbids}))::int`,
      discover: sql<number>`count(*) filter (where ${spinsTable.mbid} is not null and ${spinsTable.mbid} not in (${userMbids}))::int`,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(isNotNull(spinsTable.mbid))
    .groupBy(
      spinDayExpr,
      spinsTable.stationId,
      spinsTable.showId,
      stationsTable.slug,
      stationsTable.name,
      stationsTable.stationClass,
      showsTable.name,
      showsTable.djName,
    )
    .having(sql`count(*) filter (where ${spinsTable.mbid} in (${userMbids})) > 0`)
    .orderBy(
      sql`count(*) filter (where ${spinsTable.mbid} in (${userMbids})) desc`,
      sql`count(*) filter (where ${spinsTable.mbid} is not null and ${spinsTable.mbid} not in (${userMbids})) desc`,
    )
    .limit(30);

  return res.json({
    items: rows.map((r) => ({
      runId: r.runId,
      day: r.day,
      station: {
        slug: r.stationSlug,
        name: r.stationName,
        stationClass: r.stationClass,
      },
      show: r.showName ? { name: r.showName, djName: r.djName ?? null } : null,
      owned: r.owned,
      discover: r.discover,
    })),
  });
}));

export default router;
