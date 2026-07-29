import { randomBytes } from "node:crypto";
import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  serviceConnectionsTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  libraryImportJobsTable,
  librarySyncJobsTable,
  keepTargetsTable,
  pendingKeepsTable,
  recordingsTable,
  resolutionCacheTable,
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
  upsertLoreUserForSid,
} from "../../lore/userSession.js";
import {
  fetchProfile,
} from "../../lore/spotifyConnect.js";
import {
  getConnector,
  getFreshServiceToken,
  refreshServiceToken,
} from "../../lore/serviceConnector.js";
import { encryptToken, decryptToken } from "../../lore/tokenCrypto.js";
import { normalizeKey, isrcKey } from "../../lore/resolve.js";
import { createMbResolver } from "@workspace/song-enrichment";
import { h } from "../../middlewares/asyncHandler.js";
import { spinDayExpr } from "../../lore/runs.js";
import { pickerNotOptedOut } from "../lore/shared.js";
import { getForYouStations, getForYouBlogs } from "../../lore/for-you.js";
import {
  buildExport,
  isExportFormat,
  EXPORT_CONTENT_TYPES,
  type LibraryExportRow,
} from "../../lore/library-export.js";
import { parseLibraryImport } from "../../lore/library-import.js";
import { runSyncWorker, SYNC_ZOMBIE_AGE_MS } from "../../lore/library-sync.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SID_COOKIE = "lore_sid";
const STATE_COOKIE = "lore_me_spotify_state";
const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 min
const SID_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
const APP_RETURN_PATH = process.env.LORE_APP_URL ?? "/lore/";
/** Max MBIDs per batch keep-status check. */
const KEEP_BATCH_MAX = 50;
/** Max library page size. */
const LIBRARY_PAGE_SIZE = 50;
/** Delay between resolveToMbid calls in the import worker (1.1 s ≥ MB 1 req/sec). */
const IMPORT_RESOLVE_DELAY_MS = 1100;
/** Hard cap per MB resolve call — prevents a single hanging network call from
 *  stalling the entire import indefinitely. Track is counted as unresolved. */
const IMPORT_RESOLVE_TIMEOUT_MS = 12_000;
/** Stamp partial total to DB every N items during the buffer-drain (fetching) phase. */
const FETCH_STAMP_INTERVAL = 50;

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

// ---------------------------------------------------------------------------
// Spotify library OAuth — these two routes are intentionally BEFORE
// requireUserMiddleware so they work for first-time visitors with no session.
// ---------------------------------------------------------------------------

/**
 * POST /api/me/connect/spotify/start — return OAuth URL for the library
 * permission dance (separate from the playback OAuth).
 * No auth required: just generates the Spotify consent URL + CSRF state.
 */
router.post("/me/connect/spotify/start", h(async (req, res) => {
  const connector = getConnector("spotify");
  if (!connector) return res.status(503).json({ error: "Spotify connector not available" });

  const state = randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOpts(STATE_MAX_AGE_MS));

  // ?scopes=write forces Spotify's consent screen so the user can grant
  // user-library-modify when they're reconnecting to add write access.
  const showDialog = req.query["scopes"] === "write";
  const url = connector.authStart(state, meCallbackUri(), { showDialog });
  return res.json({ url });
}));

/**
 * GET /api/me/connect/spotify/callback — OAuth callback for library connect.
 * Stores tokens in service_connections, enables keep_targets.
 * If no lore_sid session exists yet, bootstraps one from the library token
 * so first-time visitors don't need to connect playback first.
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

  try {
    const connector = getConnector("spotify");
    if (!connector) throw new Error("connector not available");

    const tokens = await connector.authCallback(code, meCallbackUri());

    // Resolve (or bootstrap) the lore_users identity.
    let user = await getUserFromSession(req);
    if (!user) {
      // No session yet — fetch the Spotify profile from the library token and
      // create a spotify_connections stub + lore_users row so every user who
      // links Spotify gets a persistent identity without needing playback first.
      const profile = await fetchProfile(tokens.accessToken);
      if (!profile.spotifyUserId) {
        res.redirect(`${APP_RETURN_PATH}?library=error&reason=no_profile`);
        return;
      }
      const newSid = randomBytes(32).toString("hex");
      await db.insert(spotifyConnectionsTable).values({
        sid: newSid,
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        displayName: profile.displayName ?? null,
        spotifyUserId: profile.spotifyUserId,
      });
      user = await upsertLoreUserForSid(profile.spotifyUserId, newSid);
      res.cookie(SID_COOKIE, newSid, cookieOpts(SID_MAX_AGE_MS));
    }

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

// All routes below this line require an authenticated lore session.
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

  // Reject if a job is already actively running or pending — triggering another
  // would fire two concurrent Spotify API pagination loops, almost guaranteeing
  // a 429 rate-limit error on both.
  //
  // Exception: if the existing job is older than ZOMBIE_AGE_MS it was almost
  // certainly orphaned by a server restart (the setImmediate worker died with
  // the process). Mark it failed and let the user start fresh.
  const ZOMBIE_AGE_MS = 30 * 60_000; // 30 minutes
  const [existingJob] = await db
    .select({
      id: libraryImportJobsTable.id,
      status: libraryImportJobsTable.status,
      startedAt: libraryImportJobsTable.startedAt,
    })
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.userId, user.id),
        eq(libraryImportJobsTable.service, service),
        inArray(libraryImportJobsTable.status, ["running", "pending"]),
      ),
    )
    .limit(1);

  if (existingJob) {
    const ageMs = Date.now() - existingJob.startedAt.getTime();
    if (ageMs > ZOMBIE_AGE_MS) {
      // Orphaned job — clear it so the user gets a fresh import.
      console.warn(`[me/import] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) — resetting`);
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: "Import interrupted (server restarted) — please try again", finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, existingJob.id));
    } else {
      return res.status(409).json({
        jobId: existingJob.id,
        status: existingJob.status,
        error: "An import is already in progress — check its status before starting another.",
      });
    }
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
 * POST /api/me/library/import/file — synchronous `lore.library.v1` JSON import.
 * Round-trip contract: importing a Lore export reproduces the library exactly
 * (mbids, added_at, provenance verbatim). Existing items are skipped
 * idempotently; per-item failures are reported, never partial-silent.
 * Unknown mbids: when the file carries title+artist we seed the spine row
 * from that real exported data (background jobs enrich later); otherwise the
 * item is rejected with a reason — mirroring the honesty rule everywhere else.
 */
router.post(
  "/me/library/import/file",
  h(async (req, res) => {
    const user = (req as AuthedRequest).loreUser;
    const parsed = parseLibraryImport(req.body);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const { items, itemErrors } = parsed;
    const errors: Array<{ index: number; reason: string }> = [...itemErrors];
    let imported = 0;
    let skipped = 0;

    if (items.length > 0) {
      // One query: which of the file's mbids are already on the spine, and
      // which are already in this user's library.
      const mbids = [...new Set(items.map((i) => i.mbid))];
      const known = new Set(
        (
          await db
            .select({ mbid: recordingsTable.mbid })
            .from(recordingsTable)
            .where(inArray(recordingsTable.mbid, mbids))
        ).map((r) => r.mbid),
      );
      const owned = new Set(
        (
          await db
            .select({ mbid: libraryItemsTable.mbid })
            .from(libraryItemsTable)
            .where(
              and(
                eq(libraryItemsTable.userId, user.id),
                inArray(libraryItemsTable.mbid, mbids),
              ),
            )
        ).map((r) => r.mbid),
      );

      const seenInFile = new Set<string>();
      for (const item of items) {
        const origIndex = item.sourceIndex;
        if (seenInFile.has(item.mbid)) {
          skipped++;
          continue;
        }
        seenInFile.add(item.mbid);

        if (owned.has(item.mbid)) {
          skipped++;
          continue;
        }

        // FK guard: recordings row must exist before library_items insert.
        if (!known.has(item.mbid)) {
          if (!item.title || !item.artist) {
            errors.push({
              index: origIndex,
              reason: "unknown mbid and no title/artist in file to seed it",
            });
            continue;
          }
          // Seed the spine row from the file's own exported data — real
          // values the user exported, never fabricated. Enrichment
          // (links, genres, ISRC check) converges via background jobs.
          await db
            .insert(recordingsTable)
            .values({
              mbid: item.mbid,
              title: item.title,
              artist: item.artist,
              ...(item.isrc ? { isrc: item.isrc } : {}),
              ...(item.releaseYear != null ? { releaseYear: item.releaseYear } : {}),
            })
            .onConflictDoNothing();
          known.add(item.mbid);
        }

        const inserted = await db
          .insert(libraryItemsTable)
          .values({
            userId: user.id,
            mbid: item.mbid,
            provenance: item.provenance,
            addedAt: item.addedAt,
          })
          .onConflictDoNothing()
          .returning({ id: libraryItemsTable.id });
        if (inserted.length > 0) imported++;
        else skipped++;
      }
    }

    return res.json({
      imported,
      skipped,
      rejected: errors.length,
      // Cap the error detail so a fully-malformed 50k file doesn't return MBs.
      errors: errors.slice(0, 50),
    });
  }),
);

/**
 * GET /api/me/library/import — return the most recent import job for the user,
 * or 404 if no jobs exist yet.  Used by the frontend to detect in-progress or
 * recently finished imports without needing to track a jobId across tabs.
 */
router.get("/me/library/import", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const [job] = await db
    .select()
    .from(libraryImportJobsTable)
    .where(eq(libraryImportJobsTable.userId, user.id))
    .orderBy(desc(libraryImportJobsTable.startedAt))
    .limit(1);

  if (!job) return res.status(404).json({ error: "No import jobs found" });

  return res.json({
    jobId: job.id,
    service: job.service,
    status: job.status,
    phase: job.phase ?? null,
    total: job.total,
    resolved: job.resolved,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
  });
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
    phase: job.phase ?? null,
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

export async function runImportWorker(
  jobId: number,
  userId: number,
  service: string,
  conn: typeof serviceConnectionsTable.$inferSelect,
): Promise<void> {
  try {
    console.log(`[me/import] job=${jobId} starting (service=${service})`);
    await db
      .update(libraryImportJobsTable)
      .set({ status: "running" })
      .where(eq(libraryImportJobsTable.id, jobId));

    console.log(`[me/import] job=${jobId} fetching token…`);
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

    // ── Buffer drain ───────────────────────────────────────────────────────────
    // Page through the service API (fast, no rate-limit) and collect every
    // track upfront so we know the total before any resolution work begins.
    await db
      .update(libraryImportJobsTable)
      .set({ phase: "fetching" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const buffer: Array<{ artist: string; title: string; isrc?: string; durationMs?: number; externalId: string }> = [];
    let lastFetchStamp = 0;
    for await (const raw of connector.importLibrary(accessToken)) {
      buffer.push({
        artist: raw.artist,
        title: raw.title,
        isrc: raw.isrc,
        durationMs: raw.durationMs,
        externalId: raw.externalId ?? `${raw.artist}\u001f${raw.title}`,
      });
      if (buffer.length - lastFetchStamp >= FETCH_STAMP_INTERVAL) {
        lastFetchStamp = buffer.length;
        await db
          .update(libraryImportJobsTable)
          .set({ total: buffer.length })
          .where(eq(libraryImportJobsTable.id, jobId));
      }
    }
    const total = buffer.length;
    let resolved = 0;

    // Stamp total immediately so the progress bar is honest from the start.
    await db
      .update(libraryImportJobsTable)
      .set({ total, phase: "spine" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const provenance: LibraryItemProvenance = { kind: "import", service };

    // Track which buffer entries have already been resolved (by position).
    const matchedIdx = new Set<number>();

    // ── Phase 1: ISRC bulk pre-match against recordings ───────────────────────
    // Tracks whose ISRC is already on the spine need zero MB calls and no sleep.
    const isrcEntries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => Boolean(t.isrc));

    if (isrcEntries.length > 0) {
      const uniqueIsrcs = [...new Set(isrcEntries.map(({ t }) => t.isrc!))];
      const isrcMatches = await db
        .select({ mbid: recordingsTable.mbid, isrc: recordingsTable.isrc })
        .from(recordingsTable)
        .where(inArray(recordingsTable.isrc, uniqueIsrcs));
      const isrcToMbid = new Map(isrcMatches.map((r) => [r.isrc!, r.mbid]));

      for (const { t, i } of isrcEntries) {
        const mbid = isrcToMbid.get(t.isrc!);
        if (mbid) {
          await db
            .insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
          matchedIdx.add(i);
        }
      }

      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Phase 2: resolution-cache bulk pre-check ──────────────────────────────
    // Tracks already resolved in a prior import/spin have a cache entry — look
    // them all up in one query. Still no MB call, no sleep.
    await db
      .update(libraryImportJobsTable)
      .set({ phase: "cache" })
      .where(eq(libraryImportJobsTable.id, jobId));

    const phase2Entries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedIdx.has(i));

    if (phase2Entries.length > 0) {
      // Build one flat list of all cache keys (ISRC-namespaced + text), deduped.
      const keySet = new Set<string>();
      // Map each cache key back to the buffer indices it represents so we can
      // resolve a hit back to the right track without re-scanning.
      const keyToIndices = new Map<string, number[]>();
      const addKey = (k: string, i: number) => {
        keySet.add(k);
        const arr = keyToIndices.get(k) ?? [];
        arr.push(i);
        keyToIndices.set(k, arr);
      };

      for (const { t, i } of phase2Entries) {
        if (t.isrc) addKey(isrcKey(t.isrc), i);
        addKey(normalizeKey(t.artist, t.title), i);
      }

      const allKeys = [...keySet];
      const cacheRows = await db
        .select({ key: resolutionCacheTable.key, mbid: resolutionCacheTable.mbid })
        .from(resolutionCacheTable)
        .where(inArray(resolutionCacheTable.key, allKeys));
      const cacheMap = new Map(cacheRows.map((r) => [r.key, r.mbid]));

      // Per-track: collect the best mbid (prefer ISRC key hit over text key).
      // indexToMbid accumulates the first non-null hit per index.
      const indexToMbid = new Map<number, string>();
      for (const { t, i } of phase2Entries) {
        if (indexToMbid.has(i)) continue;
        // ISRC key first (stronger).
        if (t.isrc) {
          const mbid = cacheMap.get(isrcKey(t.isrc));
          if (mbid) { indexToMbid.set(i, mbid); continue; }
        }
        const mbid = cacheMap.get(normalizeKey(t.artist, t.title));
        if (mbid) indexToMbid.set(i, mbid);
      }

      if (indexToMbid.size > 0) {
        // Batch-verify candidate MBIDs exist in recordings (FK guard).
        const candidateMbids = [...new Set(indexToMbid.values())];
        const existingRecs = await db
          .select({ mbid: recordingsTable.mbid })
          .from(recordingsTable)
          .where(inArray(recordingsTable.mbid, candidateMbids));
        const existingSet = new Set(existingRecs.map((r) => r.mbid));

        for (const [idx, mbid] of indexToMbid) {
          if (!existingSet.has(mbid)) continue;
          await db
            .insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
          matchedIdx.add(idx);
        }
      }

      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    // ── Phase 3: serial MB resolution for true misses ─────────────────────────
    // Only tracks with no cache/spine hit reach here. Sleep 1.1 s ONLY after a
    // call where resolveToMbid made a real MusicBrainz network request.
    const phase3Entries = buffer
      .map((t, i) => ({ t, i }))
      .filter(({ i }) => !matchedIdx.has(i));

    await db
      .update(libraryImportJobsTable)
      .set({ phase: "resolve", total, resolved })
      .where(eq(libraryImportJobsTable.id, jobId));

    // Phase 3 uses its own isolated MB chain so it doesn't compete with the
    // process-wide enrichment pipeline chain (which is continuously fed by
    // station pollers). Each call gets an AbortController: when the per-track
    // timeout fires the controller aborts, and any ghost slot that's still
    // queued in the isolated chain exits immediately on abort-check — no sleep,
    // no network call — so the queue never backs up.
    const mbResolver = createMbResolver();
    const PHASE3_BUDGET_MS = 5 * 60_000; // 5 minutes wall-clock max for Phase 3
    const phase3StartMs = Date.now();

    for (const { t } of phase3Entries) {
      // Hard wall-clock budget: stop gracefully rather than running forever.
      if (Date.now() - phase3StartMs > PHASE3_BUDGET_MS) {
        console.warn(
          `[me/import] Phase 3 budget (${PHASE3_BUDGET_MS / 1000}s) exceeded — ` +
            `marking import done with ${resolved}/${total} resolved`,
        );
        break;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn(`[me/import] resolve timeout for "${t.title}" by "${t.artist}" — skipping`);
        controller.abort();
      }, IMPORT_RESOLVE_TIMEOUT_MS);

      let mbid: string | null = null;
      try {
        // Try ISRC first (one MB lookup, high confidence); fall back to text.
        if (t.isrc) {
          mbid = await mbResolver.resolveByIsrc(t.isrc, controller.signal);
        }
        if (!mbid && !controller.signal.aborted) {
          mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
        }
      } catch {
        // resolveBy* are best-effort and never throw — defensive catch only.
      } finally {
        clearTimeout(timer);
      }

      if (mbid) {
        // FK guard: only insert if recordings row exists.
        const [rec] = await db
          .select({ mbid: recordingsTable.mbid })
          .from(recordingsTable)
          .where(eq(recordingsTable.mbid, mbid))
          .limit(1);

        if (rec) {
          await db
            .insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          // Cache the result so future imports resolve this track from Phase 2
          // (DB-only, no MB network call).
          await db
            .insert(resolutionCacheTable)
            .values([
              ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid }] : []),
              { key: normalizeKey(t.artist, t.title), mbid },
            ])
            .onConflictDoNothing()
            .catch(() => {});
          resolved++;
        }
      }

      // Sleep only when we actually attempted a network call (signal not yet
      // aborted at the point resolveBy* ran). Ghost-aborted slots are free.
      if (!controller.signal.aborted) {
        await sleep(IMPORT_RESOLVE_DELAY_MS);
      }

      // Update after every track — Phase 3 is slow (≥1.1 s/track) so each
      // write is cheap relative to the sleep that follows.
      await db
        .update(libraryImportJobsTable)
        .set({ total, resolved })
        .where(eq(libraryImportJobsTable.id, jobId));
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

/** Cursor field separator for name-sorted library pages (see library GET). */
const LIB_CURSOR_SEP = "\u001f";

/** Escape LIKE wildcards so user search text is matched literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * GET /api/me/library — paginated list of kept + imported recordings.
 *
 * Query params:
 * - `sort`  — "added" (default, newest first) | "artist" | "title" (A→Z).
 * - `q`     — case-insensitive substring match on title or artist.
 * - `source`— "keep" | "import" (provenance.kind filter).
 * - `cursor`— keyset cursor. For sort=added it's the last row's addedAt ISO;
 *   for name sorts it's `<sortKey>\u001f<mbid>` (tuple keyset, mbid tiebreak).
 * - `limit` — page size (max 100).
 */
router.get("/me/library", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const cursor =
    typeof req.query["cursor"] === "string" ? req.query["cursor"].trim() : null;
  const limit = Math.min(
    parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10) || LIBRARY_PAGE_SIZE,
    100,
  );
  const q =
    typeof req.query["q"] === "string" ? req.query["q"].trim() : "";
  const sortRaw =
    typeof req.query["sort"] === "string" ? req.query["sort"] : "added";
  const sort: "added" | "artist" | "title" =
    sortRaw === "artist" || sortRaw === "title" ? sortRaw : "added";
  const sourceRaw =
    typeof req.query["source"] === "string" ? req.query["source"] : "";
  const source: "keep" | "import" | null =
    sourceRaw === "keep" || sourceRaw === "import" ? sourceRaw : null;

  const conditions = [eq(libraryItemsTable.userId, user.id)];

  if (q.length > 0) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      sql`(${recordingsTable.title} ILIKE ${pattern} OR ${recordingsTable.artist} ILIKE ${pattern})`,
    );
  }
  if (source) {
    conditions.push(
      sql`${libraryItemsTable.provenance}->>'kind' = ${source}`,
    );
  }

  // Sort key for name sorts: lower(primary field, then the other as tiebreak),
  // coalesced so join-miss rows (no recordings match) sort deterministically.
  const sortKeyExpr =
    sort === "artist"
      ? sql<string>`lower(coalesce(${recordingsTable.artist}, '') || ' ' || coalesce(${recordingsTable.title}, ''))`
      : sql<string>`lower(coalesce(${recordingsTable.title}, '') || ' ' || coalesce(${recordingsTable.artist}, ''))`;

  if (cursor) {
    if (sort === "added") {
      conditions.push(
        sql`${libraryItemsTable.addedAt} < ${cursor}::timestamptz`,
      );
    } else {
      const sep = cursor.lastIndexOf(LIB_CURSOR_SEP);
      if (sep < 0) {
        return res.status(400).json({ error: "Malformed cursor for this sort" });
      }
      const keyPart = cursor.slice(0, sep);
      const mbidPart = cursor.slice(sep + 1);
      conditions.push(
        sql`(${sortKeyExpr}, ${libraryItemsTable.mbid}) > (${keyPart}, ${mbidPart})`,
      );
    }
  }

  const rows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      sortKey: sortKeyExpr.as("sort_key"),
      // Scalar subquery: primary release group title (at most one row).
      albumTitle: sql<string | null>`(
        SELECT title FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
    })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .where(and(...conditions))
    .orderBy(
      ...(sort === "added"
        ? [desc(libraryItemsTable.addedAt)]
        : [asc(sortKeyExpr), asc(libraryItemsTable.mbid)]),
    )
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return res.json({
    items: items.map((r) => ({
      mbid: r.mbid,
      provenance: r.provenance,
      addedAt: r.addedAt.toISOString(),
      recording: r.title
        ? {
            title: r.title,
            artist: r.artist,
            artworkUrl: r.artworkUrl ?? null,
            albumTitle: r.albumTitle ?? null,
            spotifyUrl:
              (r.links as Array<{ url: string }> | null)?.find((l) =>
                l.url.includes("open.spotify.com"),
              )?.url ?? null,
          }
        : null,
    })),
    nextCursor: !hasMore || !last
      ? null
      : sort === "added"
        ? last.addedAt.toISOString()
        : `${last.sortKey}${LIB_CURSOR_SEP}${last.mbid}`,
  });
}));

/** Hard cap on rows in one export file. */
const EXPORT_MAX_ROWS = 50_000;

/**
 * GET /api/me/library/export?format=csv|json|m3u8|txt — download the whole
 * library as a file. One provenance-joined query, formatted synchronously —
 * no inline MusicBrainz lookups (ISRCs converge via the background
 * enrichment job; missing ones export empty/null, never fabricated).
 */
router.get("/me/library/export", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const format = req.query["format"];
  if (!isExportFormat(format)) {
    return res.status(400).json({ error: "format must be one of csv, json, m3u8, txt" });
  }

  const rows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      isrc: recordingsTable.isrc,
      releaseYear: recordingsTable.releaseYear,
      album: sql<string | null>`(
        SELECT title FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
      releaseGroupMbid: sql<string | null>`(
        SELECT release_group_mbid FROM recording_release_groups
        WHERE recording_mbid = ${libraryItemsTable.mbid} AND is_primary = true
        LIMIT 1
      )`,
      spinPlayedAt: spinsTable.playedAt,
      spinStationSlug: stationsTable.slug,
      spinStationName: stationsTable.name,
      spinShowName: showsTable.name,
    })
    .from(libraryItemsTable)
    .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
    .leftJoin(spinsTable, eq(libraryItemsTable.spinId, spinsTable.id))
    .leftJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .leftJoin(showsTable, eq(spinsTable.showId, showsTable.id))
    .where(eq(libraryItemsTable.userId, user.id))
    .orderBy(desc(libraryItemsTable.addedAt))
    .limit(EXPORT_MAX_ROWS);

  const exportRows: LibraryExportRow[] = rows.map((r) => ({
    mbid: r.mbid,
    title: r.title,
    artist: r.artist,
    album: r.album,
    releaseGroupMbid: r.releaseGroupMbid,
    releaseYear: r.releaseYear,
    isrc: r.isrc,
    addedAt: r.addedAt,
    provenance: r.provenance,
    spin: r.spinPlayedAt || r.spinStationSlug
      ? {
          stationSlug: r.spinStationSlug,
          stationName: r.spinStationName,
          showName: r.spinShowName,
          playedAt: r.spinPlayedAt,
        }
      : null,
  }));

  const now = new Date();
  const body = buildExport(format, exportRows, now);
  const stamp = now.toISOString().slice(0, 10);
  res.setHeader("Content-Type", EXPORT_CONTENT_TYPES[format]);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="lore-library-${stamp}.${format}"`,
  );
  return res.send(body);
}));

// ---------------------------------------------------------------------------
// Keep endpoints
// ---------------------------------------------------------------------------

/**
 * POST /api/me/keep — upsert a recording into library_items and optionally
 * mirror to enabled streaming services.
 * Body: { mbid: string, provenance?: object }
 *    OR { spinId: number, provenance?: object }  ← unresolved-track path
 */
router.post("/me/keep", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const { mbid, spinId, provenance: provenanceOverride } = req.body as {
    mbid?: string;
    spinId?: number;
    provenance?: Partial<LibraryItemProvenance>;
  };

  // ── Spin-based save (unresolved or not-yet-resolved track) ────────────────
  if (!mbid && spinId != null) {
    const [spin] = await db
      .select({ id: spinsTable.id, mbid: spinsTable.mbid })
      .from(spinsTable)
      .where(eq(spinsTable.id, spinId))
      .limit(1);

    if (!spin) return res.status(404).json({ error: "Spin not found" });

    // If the spin already resolved, also write to library_items.
    let promotedAt: Date | null = null;
    if (spin.mbid) {
      // Spread first, then force kind — clients may pass display kinds like
      // "station" in the override, but the stored kind is always "keep".
      const provenance: LibraryItemProvenance = { ...provenanceOverride, kind: "keep" };
      await db
        .insert(libraryItemsTable)
        .values({ userId: user.id, mbid: spin.mbid, provenance, spinId: spin.id, addedAt: new Date() })
        .onConflictDoUpdate({
          target: [libraryItemsTable.userId, libraryItemsTable.mbid],
          set: { provenance, spinId: spin.id, addedAt: new Date() },
        });
      promotedAt = new Date();
    }

    await db
      .insert(pendingKeepsTable)
      .values({ userId: user.id, spinId: spin.id, promotedAt })
      .onConflictDoUpdate({
        target: [pendingKeepsTable.userId, pendingKeepsTable.spinId],
        set: { promotedAt },
      });

    return res.json({ keptToLore: promotedAt != null, pendingKept: true, mirrors: [] });
  }

  // ── MBID-based (resolved) keep ────────────────────────────────────────────
  if (!mbid || typeof mbid !== "string") {
    return res.status(400).json({ error: "mbid or spinId is required" });
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
    ...provenanceOverride,
    kind: "keep",
  };

  // When the client keeps a resolved track off a live play it can pass the
  // spin id alongside the mbid. Only store the link when the spin actually
  // resolved to this mbid — never persist mismatched provenance.
  let keepSpinId: number | null = null;
  if (spinId != null) {
    const [s] = await db
      .select({ id: spinsTable.id })
      .from(spinsTable)
      .where(and(eq(spinsTable.id, spinId), eq(spinsTable.mbid, mbid)))
      .limit(1);
    keepSpinId = s?.id ?? null;
  }

  await db
    .insert(libraryItemsTable)
    .values({ userId: user.id, mbid, provenance, spinId: keepSpinId, addedAt: new Date() })
    .onConflictDoUpdate({
      target: [libraryItemsTable.userId, libraryItemsTable.mbid],
      set: {
        provenance,
        addedAt: new Date(),
        ...(keepSpinId != null ? { spinId: keepSpinId } : {}),
      },
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
 * DELETE /api/me/keep/spin/:spinId — remove a spin-based save.
 * Deletes from pending_keeps; if the spin resolved, also removes library_items.
 * Must be registered before DELETE /me/keep/:mbid or "spin" matches :mbid.
 */
router.delete("/me/keep/spin/:spinId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const spinId = parseInt(typeof req.params.spinId === "string" ? req.params.spinId : "", 10);
  if (isNaN(spinId)) return res.status(400).json({ error: "invalid spinId" });

  await db
    .delete(pendingKeepsTable)
    .where(and(eq(pendingKeepsTable.userId, user.id), eq(pendingKeepsTable.spinId, spinId)));

  // If the spin has an MBID, clean up library_items too.
  const [spin] = await db
    .select({ mbid: spinsTable.mbid })
    .from(spinsTable)
    .where(eq(spinsTable.id, spinId))
    .limit(1);

  if (spin?.mbid) {
    await db
      .delete(libraryItemsTable)
      .where(and(eq(libraryItemsTable.userId, user.id), eq(libraryItemsTable.mbid, spin.mbid)));
  }

  return res.status(204).end();
}));

/**
 * GET /api/me/keep/pending-status?spinIds=1,2,3 — batch spin save-state check.
 * Returns two sets:
 *   savedSpinIds  — spin was saved AND promoted to library_items (resolved)
 *   pendingSpinIds — spin was saved but not yet resolved to an MBID
 */
router.get("/me/keep/pending-status", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawIds = typeof req.query.spinIds === "string" ? req.query.spinIds : "";
  const spinIds = rawIds
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0)
    .slice(0, 50);

  if (spinIds.length === 0) return res.json({ savedSpinIds: [], pendingSpinIds: [] });

  const rows = await db
    .select({ spinId: pendingKeepsTable.spinId, promotedAt: pendingKeepsTable.promotedAt })
    .from(pendingKeepsTable)
    .where(
      and(
        eq(pendingKeepsTable.userId, user.id),
        inArray(pendingKeepsTable.spinId, spinIds),
      ),
    );

  const savedSpinIds = rows.filter((r) => r.promotedAt != null).map((r) => r.spinId);
  const pendingSpinIds = rows.filter((r) => r.promotedAt == null).map((r) => r.spinId);

  return res.json({ savedSpinIds, pendingSpinIds });
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

// ---------------------------------------------------------------------------
// For-You endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/me/stations/for-you — stations ranked by four-tier personalization:
 * (1) artist overlap with user's library, (2) in-Lore keeps, (3) followed-picker
 * affinity (future), (4) popularity cold-start. Grouped by genre pole.
 * Optional: ?genre=jazz  ?limit=20
 */
router.get("/me/stations/for-you", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const genre =
    typeof req.query["genre"] === "string" && req.query["genre"].trim()
      ? req.query["genre"].trim().toLowerCase()
      : undefined;
  const limitRaw = parseInt(String(req.query["limit"] ?? ""), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

  const result = await getForYouStations(user, { genre, limit });

  return res.json({
    genre_poles: result.genre_poles.map((pole) => ({
      genre: pole.genre,
      items: pole.items.map((s) => ({
        slug: s.slug,
        name: s.name,
        org: s.org,
        streamUrl: s.streamUrl,
        streamFormat: s.streamFormat,
        homepageUrl: s.homepageUrl,
        logoUrl: s.logoUrl,
        tags: s.tags,
        popularity: s.clickcount + s.votes,
        overlap: s.overlap,
      })),
    })),
    cold_start: result.cold_start,
    ...(result.prompt ? { prompt: result.prompt } : {}),
  });
}));

/**
 * GET /api/me/blogs/for-you — blog pickers ranked by four-tier personalization.
 * Optional: ?genre=jazz  ?limit=20
 */
router.get("/me/blogs/for-you", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const genre =
    typeof req.query["genre"] === "string" && req.query["genre"].trim()
      ? req.query["genre"].trim().toLowerCase()
      : undefined;
  const limitRaw = parseInt(String(req.query["limit"] ?? ""), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;

  const result = await getForYouBlogs(user, { genre, limit });

  return res.json({
    genre_poles: result.genre_poles.map((pole) => ({
      genre: pole.genre,
      items: pole.items.map((b) => ({
        handle: b.handle,
        name: b.name,
        homeUrl: b.homeUrl,
        tags: b.tags,
        pick_count: b.pickCount,
        overlap: b.overlap,
      })),
    })),
    cold_start: result.cold_start,
    ...(result.prompt ? { prompt: result.prompt } : {}),
  });
}));

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
        pickerNotOptedOut(pickersTable.id),
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
        eq(stationsTable.hidden, false),
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
    .where(and(isNotNull(spinsTable.mbid), eq(stationsTable.hidden, false)))
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

// ---------------------------------------------------------------------------
// Library sync — push Lore library → Spotify saved tracks
// ---------------------------------------------------------------------------

/**
 * POST /api/me/library/sync — start a background sync job.
 * Returns 400 when the service connection has no write scope (canWrite=false)
 * rather than starting a job that will inevitably fail, with a re-auth hint.
 */
router.post("/me/library/sync", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const service = typeof req.query["service"] === "string" ? req.query["service"].trim() : "spotify";

  const [conn] = await db
    .select()
    .from(serviceConnectionsTable)
    .where(and(eq(serviceConnectionsTable.userId, user.id), eq(serviceConnectionsTable.service, service)))
    .limit(1);

  if (!conn) {
    return res.status(400).json({ error: `No ${service} connection found; connect first.` });
  }

  if (!conn.canWrite) {
    return res.status(403).json({
      error: "canWrite:false",
      message: "Your Spotify connection doesn't have write access. Reconnect Spotify to grant it.",
      reAuthUrl: null,
    });
  }

  // Zombie-reset: mark stuck jobs as error before starting a new one.
  const ZOMBIE_AGE_MS = SYNC_ZOMBIE_AGE_MS;
  const [existingJob] = await db
    .select({ id: librarySyncJobsTable.id, status: librarySyncJobsTable.status, startedAt: librarySyncJobsTable.startedAt })
    .from(librarySyncJobsTable)
    .where(and(
      eq(librarySyncJobsTable.userId, user.id),
      eq(librarySyncJobsTable.service, service),
      inArray(librarySyncJobsTable.status, ["running", "pending"]),
    ))
    .limit(1);

  if (existingJob) {
    const ageMs = Date.now() - existingJob.startedAt.getTime();
    if (ageMs > ZOMBIE_AGE_MS) {
      console.warn(`[me/sync] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) — resetting`);
      await db
        .update(librarySyncJobsTable)
        .set({ status: "error", error: "Sync interrupted (server restarted) — please try again", finishedAt: new Date() })
        .where(eq(librarySyncJobsTable.id, existingJob.id));
    } else {
      return res.status(409).json({
        jobId: existingJob.id,
        status: existingJob.status,
        error: "A sync is already in progress.",
      });
    }
  }

  const [job] = await db
    .insert(librarySyncJobsTable)
    .values({ userId: user.id, service, status: "pending", total: 0, processed: 0, startedAt: new Date() })
    .returning();

  setImmediate(() => runSyncWorker(job!.id, user.id, conn));

  return res.status(202).json({ jobId: job!.id, status: "pending" });
}));

function formatSyncJob(job: typeof librarySyncJobsTable.$inferSelect) {
  return {
    jobId: job.id,
    service: job.service,
    status: job.status,
    phase: job.phase ?? null,
    total: job.total,
    processed: job.processed,
    startedAt: job.startedAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    results: job.results ?? null,
  };
}

/**
 * GET /api/me/library/sync — most recent sync job for the user (404 if none).
 */
router.get("/me/library/sync", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(eq(librarySyncJobsTable.userId, user.id))
    .orderBy(desc(librarySyncJobsTable.startedAt))
    .limit(1);
  if (!job) return res.status(404).json({ error: "No sync jobs found" });
  return res.json(formatSyncJob(job));
}));

/**
 * GET /api/me/library/sync/:jobId/unavailable — full paginated list of tracks
 * that could not be found on Spotify for a completed sync job.
 *
 * Query params:
 * - `format` — "json" (default) | "csv" — set Content-Disposition when csv.
 * - `page`   — 1-based page number (default 1). Ignored for csv (returns all).
 * - `limit`  — page size 1–1000 (default 200).
 *
 * Response body (json): { items: [{mbid,artist,title,bandcampUrl}], total, page, limit, pages }
 *
 * The list is sourced by joining the stored unavailableMbids from the receipt
 * against the recordings table — artist/title are never fabricated, they come
 * from the spine. Jobs from before this feature shipped have no unavailableMbids
 * and fall back to the capped unavailableItems preview list.
 */
router.get("/me/library/sync/:jobId/unavailable", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const rawJobId = req.params.jobId;
  const jobId = parseInt(typeof rawJobId === "string" ? rawJobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });

  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(and(eq(librarySyncJobsTable.id, jobId), eq(librarySyncJobsTable.userId, user.id)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "done" || !job.results) {
    return res.status(400).json({ error: "Job is not complete" });
  }

  const receipt = job.results;
  const total = receipt.unavailable;

  const formatRaw = req.query["format"];
  const format = formatRaw === "csv" ? "csv" : "json";
  const limitRaw = parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10);
  const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 1000));
  const pageRaw = parseInt(typeof req.query["page"] === "string" ? req.query["page"] : "", 10);
  const page = isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);

  /** Build Bandcamp search URL for a track. */
  const bcUrl = (artist: string, title: string) =>
    `https://bandcamp.com/search?q=${encodeURIComponent(`${artist} ${title}`)}`;

  interface UnavailableRow { mbid: string; artist: string; title: string; bandcampUrl: string }

  let allItems: UnavailableRow[];

  if (receipt.unavailableMbids && receipt.unavailableMbids.length > 0) {
    // New-style receipt: full MBID list stored, join recordings for details.
    const mbids = receipt.unavailableMbids;
    const recs = await db
      .select({ mbid: recordingsTable.mbid, artist: recordingsTable.artist, title: recordingsTable.title })
      .from(recordingsTable)
      .where(inArray(recordingsTable.mbid, mbids));
    const recMap = new Map(recs.map((r) => [r.mbid, r]));

    allItems = mbids.map((mbid) => {
      const rec = recMap.get(mbid);
      const artist = rec?.artist ?? "";
      const title = rec?.title ?? "";
      return { mbid, artist, title, bandcampUrl: bcUrl(artist, title) };
    });
  } else {
    // Legacy receipt (no unavailableMbids): fall back to the capped preview list.
    allItems = receipt.unavailableItems.map((item) => ({
      mbid: item.mbid,
      artist: item.artist,
      title: item.title,
      bandcampUrl: item.bandcampUrl,
    }));
  }

  if (format === "csv") {
    const lines = [
      "mbid,artist,title,bandcamp_url",
      ...allItems.map((r) => [r.mbid, r.artist, r.title, r.bandcampUrl]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sync-${jobId}-unavailable.csv"`,
    );
    return res.send(lines.join("\n"));
  }

  // JSON: paginate.
  const offset = (page - 1) * limit;
  const pageItems = allItems.slice(offset, offset + limit);
  const pages = Math.ceil(allItems.length / limit) || 1;

  return res.json({ items: pageItems, total, page, limit, pages });
}));

/**
 * GET /api/me/library/sync/:jobId — poll sync job progress.
 */
router.get("/me/library/sync/:jobId", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const jobId = parseInt(typeof req.params.jobId === "string" ? req.params.jobId : "", 10);
  if (isNaN(jobId)) return res.status(400).json({ error: "Invalid jobId" });
  const [job] = await db
    .select()
    .from(librarySyncJobsTable)
    .where(and(eq(librarySyncJobsTable.id, jobId), eq(librarySyncJobsTable.userId, user.id)))
    .limit(1);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json(formatSyncJob(job));
}));

/**
 * Mark any import jobs that are stuck in status="running" as failed.
 * Called once at server startup — if the process was killed mid-import the DB
 * row stays "running" forever with no worker driving it.  Resetting them to
 * "error" lets users see a clear failure message and re-trigger the import.
 */
/** Reset stuck sync jobs on boot. */
export async function markOrphanedSyncJobsAsError(): Promise<void> {
  try {
    const orphaned = await db
      .update(librarySyncJobsTable)
      .set({ status: "error", error: "Server restarted — please start a new sync", finishedAt: new Date() })
      .where(inArray(librarySyncJobsTable.status, ["running", "pending"]))
      .returning({ id: librarySyncJobsTable.id });
    if (orphaned.length > 0) {
      console.log(`[me] marked ${orphaned.length} orphaned sync job(s) as error`);
    }
  } catch (err) {
    console.error("[me] failed to clear orphaned sync jobs", err);
  }
}

export async function markOrphanedImportJobsAsError(): Promise<void> {
  try {
    const orphaned = await db
      .update(libraryImportJobsTable)
      .set({
        status: "error",
        error: "Server restarted while job was running — please start a new import",
        finishedAt: new Date(),
      })
      .where(inArray(libraryImportJobsTable.status, ["running", "pending"]))
      .returning({ id: libraryImportJobsTable.id });

    if (orphaned.length > 0) {
      console.log(`[me] marked ${orphaned.length} orphaned import job(s) as error:`, orphaned.map((j) => j.id));
    }
  } catch (err) {
    console.error("[me] failed to clear orphaned import jobs", err);
  }
}

export default router;
