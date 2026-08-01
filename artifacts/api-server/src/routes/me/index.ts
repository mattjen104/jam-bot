import { randomBytes, randomUUID } from "node:crypto";
import express, { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  loreUsersTable,
  serviceConnectionsTable,
  spotifyConnectionsTable,
  libraryItemsTable,
  libraryImportJobsTable,
  librarySyncJobsTable,
  keepTargetsTable,
  pendingKeepsTable,
  recordingsTable,
  recordingReleaseGroupsTable,
  listEntriesTable,
  listsTable,
  listSourcesTable,
  resolutionCacheTable,
  spotifyLibraryItemsTable,
  picksTable,
  pickersTable,
  spinsTable,
  stationsTable,
  showsTable,
  listensTable,
  type LoreUser,
  type LibraryItemProvenance,
  type ImportBufferEntry,
} from "@workspace/db";
import { eq, and, or, isNotNull, isNull, inArray, ne, desc, asc, sql, like, gte } from "drizzle-orm";
import {
  getUserFromSession,
  getOrCreateAnonymousUser,
  recoverUserByServiceId,
  SID_COOKIE,
  SID_MAX_AGE_MS,
  cookieSidOpts,
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
  type ListenExportRow,
} from "../../lore/library-export.js";
import { parseLibraryImport } from "../../lore/library-import.js";
import { runSyncWorker, SYNC_ZOMBIE_AGE_MS } from "../../lore/library-sync.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_COOKIE = "lore_me_spotify_state";
const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 min
// SID_COOKIE and SID_MAX_AGE_MS are imported from userSession (2-year lifetime).
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
/** Shortened per-track timeout used when MB is clearly struggling (consecutive
 *  errors ≥ threshold). Prevents the budget from being burned on 12 s timeouts
 *  during a sustained rate-limit period. */
const PHASE3_HIGH_ERROR_TIMEOUT_MS = 4_000;
/** Number of consecutive MB errors (503s, network failures) before Phase 3
 *  pauses and backs off. */
const PHASE3_503_THRESHOLD = 3;
/** Base backoff duration on first threshold breach (doubles each time, capped). */
const PHASE3_503_BACKOFF_BASE_MS = 30_000; // 30 s
/** Max backoff so a sustained MB outage never stalls the worker longer than this. */
const PHASE3_503_MAX_BACKOFF_MS = 5 * 60_000; // 5 min
/** Stamp partial total to DB every N items during the buffer-drain (fetching) phase. */
const FETCH_STAMP_INTERVAL = 50;
/** How often the off-peak Phase 3 retry scheduler wakes up to check for work. */
const PHASE3_RETRY_POLL_MS = 15 * 60_000; // 15 min
/** UTC hour range [start, end) during which the off-peak retry scheduler runs. */
const PHASE3_RETRY_OFF_PEAK_HOURS: [number, number] = [2, 6]; // 2–6 AM UTC
/** Max age of a completed import job eligible for off-peak retry. */
const PHASE3_RETRY_MAX_JOB_AGE_MS = 7 * 24 * 60 * 60_000; // 7 days
/** Number of consecutive failed retry passes (zero tracks resolved) before a
 *  source job is marked retry_exhausted and skipped in all future passes.
 *  Prevents un-resolvable tracks from spawning a new retry job every night
 *  when MusicBrainz is persistently degraded. */
const PHASE3_MAX_RETRY_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/** Extend Request with the resolved user attached by requireUser. */
export interface AuthedRequest extends Request {
  loreUser: LoreUser;
}

/**
 * Middleware: resolves (or silently provisions) the `lore_users` row from the
 * `lore_sid` cookie and attaches it as `req.loreUser`.
 *
 * If no valid `lore_sid` cookie is present, a fresh anonymous user is created
 * and the cookie is set in the response before any handler runs. This means
 * every `/me/*` request auto-provisions a device identity — no login wall.
 */
async function requireUserMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    let user = await getUserFromSession(req);
    if (!user) {
      const deviceKey = randomUUID();
      user = await getOrCreateAnonymousUser(deviceKey);
      res.cookie(SID_COOKIE, deviceKey, cookieSidOpts());
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
 * Stores tokens in service_connections, enables keep_targets, and attempts
 * library recovery so a listener on a fresh device gets their prior library
 * back the moment they reconnect Spotify.
 *
 * Session provisioning: if no lore_sid cookie exists yet, an anonymous
 * lore_users row is created and the cookie is set before any handler runs.
 * Spotify is a recovery anchor, not a prerequisite for identity.
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

    // Fetch the Spotify profile early — we need the externalUserId before we
    // can attempt library recovery (recovery lookup is keyed on it).
    const profile = await fetchProfile(tokens.accessToken);
    const externalUserId = profile.spotifyUserId ?? null;

    // Resolve (or provision) the device identity.
    let user = await getUserFromSession(req);
    if (!user) {
      const deviceKey = randomUUID();
      user = await getOrCreateAnonymousUser(deviceKey);
      res.cookie(SID_COOKIE, deviceKey, cookieSidOpts());
    }

    // Recovery: if this Spotify account is already anchored to a prior Lore
    // identity, re-point the session at that user before upserting tokens.
    // This must happen BEFORE the service_connections upsert to avoid
    // temporarily violating the (service, external_user_id) unique index.
    if (externalUserId) {
      const { user: recovered, recovered: didRecover } =
        await recoverUserByServiceId("spotify", externalUserId, user.id);
      if (didRecover) {
        user = recovered;
        res.cookie(SID_COOKIE, recovered.deviceKey, cookieSidOpts());
      }
    }

    const encAccessToken = encryptToken(tokens.accessToken);
    const encRefreshToken = encryptToken(tokens.refreshToken);

    await db
      .insert(serviceConnectionsTable)
      .values({
        userId: user.id,
        service: "spotify",
        externalUserId,
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
          externalUserId,
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

  // ── Spotify rate-limit gate ────────────────────────────────────────────────
  // If the most recent import for this user/service failed with a Spotify 429,
  // extract the Retry-After and reject immediately rather than starting a new
  // job that would fail at the same point and waste the rate-limit allowance.
  {
    const [rateLimitedJob] = await db
      .select({
        error: libraryImportJobsTable.error,
        finishedAt: libraryImportJobsTable.finishedAt,
      })
      .from(libraryImportJobsTable)
      .where(and(
        eq(libraryImportJobsTable.userId, user.id),
        eq(libraryImportJobsTable.service, service),
        eq(libraryImportJobsTable.status, "error"),
        like(libraryImportJobsTable.error, "%Retry-After:%"),
        gte(libraryImportJobsTable.startedAt, new Date(Date.now() - 48 * 60 * 60_000)),
      ))
      .orderBy(desc(libraryImportJobsTable.id))
      .limit(1);

    if (rateLimitedJob?.error && rateLimitedJob.finishedAt) {
      const match = rateLimitedJob.error.match(/Retry-After:\s*(\d+)/i);
      if (match) {
        const retryAfterSec = parseInt(match[1]!, 10);
        const unlockMs = rateLimitedJob.finishedAt.getTime() + retryAfterSec * 1000;
        const remainingMs = unlockMs - Date.now();
        if (remainingMs > 0) {
          const remainingMin = Math.ceil(remainingMs / 60_000);
          return res.status(429).json({
            error: `Spotify is still rate-limiting this account. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.`,
            retryAfterSec: Math.ceil(remainingMs / 1000),
          });
        }
      }
    }
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
      // NOTE: `phase` and `bufferJson` are intentionally NOT included in this
      // set. They must survive so that runImportWorker can find the ex-zombie
      // as `prevInterrupted` and resume the fetch from buffer.length rather
      // than re-fetching tracks that were already downloaded before the server
      // restart. Resetting phase/bufferJson here would silently break resume.
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
    resumedFrom: job.resumedFrom ?? null,
    retryExhausted: job.retryExhausted ?? false,
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
    resumedFrom: job.resumedFrom ?? null,
    retryExhausted: job.retryExhausted ?? false,
  });
}));

// ---------------------------------------------------------------------------
// Soft-row helper: batch-fetch Spotify track metadata and seed spotify_library_items
// ---------------------------------------------------------------------------

const SPOTIFY_TRACK_API = "https://api.spotify.com/v1/tracks";
const ARTWORK_BATCH_SIZE = 50;
const ARTWORK_FETCH_TIMEOUT_MS = 20_000;
const ARTWORK_BATCH_GAP_MS = 200;

/**
 * For unresolved import buffer entries, fetch artwork/album/ISRC from the
 * Spotify GET /v1/tracks API (up to 50 per call) and upsert rows into
 * `spotify_library_items`.  Failures in any batch are silently skipped —
 * the row is still inserted without artwork rather than being dropped.
 *
 * Only called for service="spotify" imports.
 */
export async function seedSpotifySoftRows(
  userId: number,
  accessToken: string,
  entries: ImportBufferEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Map spotifyId → { albumName, artworkUrl, isrc } from the Spotify API.
  const metaMap = new Map<string, { albumName: string | null; artworkUrl: string | null; isrc: string | null }>();

  // Only call the API for entries whose externalId looks like a real Spotify
  // track ID (22 alphanumeric chars). Synthesised fallback keys are skipped.
  const spotifyIdPattern = /^[A-Za-z0-9]{22}$/;
  const batchableEntries = entries.filter((t) => spotifyIdPattern.test(t.externalId));

  for (let i = 0; i < batchableEntries.length; i += ARTWORK_BATCH_SIZE) {
    const batch = batchableEntries.slice(i, i + ARTWORK_BATCH_SIZE);
    const ids = batch.map((t) => t.externalId).join(",");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARTWORK_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${SPOTIFY_TRACK_API}?ids=${ids}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json() as {
          tracks: Array<{
            id: string;
            album: { name: string; images: Array<{ url: string; height: number | null }> };
            external_ids?: { isrc?: string };
          } | null>;
        };
        for (const track of data.tracks ?? []) {
          if (!track) continue;
          // Prefer the 300 px image; fall back to the first available.
          const img =
            track.album.images.find((im) => im.height === 300) ??
            track.album.images[0];
          metaMap.set(track.id, {
            albumName: track.album.name ?? null,
            artworkUrl: img?.url ?? null,
            isrc: track.external_ids?.isrc ?? null,
          });
        }
      }
    } catch {
      // Network error or timeout — continue without artwork for this batch.
    } finally {
      clearTimeout(timer);
    }
    if (i + ARTWORK_BATCH_SIZE < batchableEntries.length) await sleep(ARTWORK_BATCH_GAP_MS);
  }

  // Upsert every unresolved entry into spotify_library_items.
  for (const t of entries) {
    const meta = metaMap.get(t.externalId);
    const isRealSpotifyId = spotifyIdPattern.test(t.externalId);

    // Guard: when the entry uses a synthesised key (not a real 22-char Spotify
    // track ID), skip inserting if a real-Spotify-ID row already exists for
    // the same user+artist+title.  The duplicate soft row would prevent the
    // artist+title fallback delete in the promotion step from targeting the
    // correct (real-ID) row, leaving a dangling soft row behind.
    if (!isRealSpotifyId && t.artist && t.title) {
      const [existingRealRow] = await db
        .select({ spotifyId: spotifyLibraryItemsTable.spotifyId })
        .from(spotifyLibraryItemsTable)
        .where(
          and(
            eq(spotifyLibraryItemsTable.userId, userId),
            eq(spotifyLibraryItemsTable.artist, t.artist),
            eq(spotifyLibraryItemsTable.title, t.title),
            // Real Spotify IDs are exactly 22 alphanumeric characters.
            // Synthesised fallback keys always contain a separator character
            // and are never 22 chars, so length is a reliable discriminator.
            sql`LENGTH(${spotifyLibraryItemsTable.spotifyId}) = 22`,
          ),
        )
        .limit(1);
      if (existingRealRow) {
        console.log(`[me/import] skipping synthesised-key soft row for "${t.title}" by "${t.artist}" — real Spotify ID row already exists`);
        continue;
      }
    }

    await db
      .insert(spotifyLibraryItemsTable)
      .values({
        userId,
        spotifyId: t.externalId,
        title: t.title,
        artist: t.artist,
        albumName: meta?.albumName ?? null,
        artworkUrl: meta?.artworkUrl ?? null,
        isrc: meta?.isrc ?? t.isrc ?? null,
        addedAt: new Date(),
        mbid: null,
      })
      .onConflictDoUpdate({
        target: [spotifyLibraryItemsTable.userId, spotifyLibraryItemsTable.spotifyId],
        set: {
          title: t.title,
          artist: t.artist,
          albumName: meta?.albumName ?? null,
          artworkUrl: meta?.artworkUrl ?? null,
          isrc: meta?.isrc ?? t.isrc ?? null,
        },
      })
      .catch(() => {}); // Silently skip FK or other errors.
  }

  console.log(`[me/import] seeded ${entries.length} soft rows into spotify_library_items`);
}

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

    // ── Buffer drain (or resume) ───────────────────────────────────────────────
    // Page through the service API and collect every track upfront so we know
    // the total before resolution begins.
    //
    // TWO resume paths:
    //
    //   1. COMPLETE-BUFFER RESUME: if a recent previous job advanced past the
    //      fetch phase (phase ∈ "spine"|"cache"|"resolve") but then crashed, its
    //      buffer is already complete — skip the Spotify fetch entirely and drain
    //      the stored buffer through Phases 1–3.  This preserves API budget
    //      and avoids re-fetching thousands of tracks from Spotify.
    //
    //   2. PARTIAL-BUFFER RESUME: if a recent previous job was interrupted WHILE
    //      fetching (phase = "fetching"), its partial buffer is used as a
    //      starting offset so we continue from where it left off.
    //
    //   A re-import after a successful (status = "done") job always fetches
    //   fresh — the user's Spotify library may have changed.
    const BUFFER_MAX_AGE_MS = 24 * 60 * 60_000; // 24 h

    // Path 1: look for a recent job that completed the fetch but crashed during
    // resolution.  Its bufferJson is the full library snapshot — no re-fetch needed.
    // Only crashed jobs qualify (status = "error") — a successfully completed job
    // (status = "done") must not be reused because the user's Spotify library may
    // have changed and they expect a fresh pull.
    const [prevWithBuffer] = await db
      .select({
        id: libraryImportJobsTable.id,
        bufferJson: libraryImportJobsTable.bufferJson,
      })
      .from(libraryImportJobsTable)
      .where(and(
        eq(libraryImportJobsTable.userId, userId),
        eq(libraryImportJobsTable.service, service),
        ne(libraryImportJobsTable.id, jobId),
        eq(libraryImportJobsTable.status, "error"),
        inArray(libraryImportJobsTable.phase, ["spine", "cache", "resolve"]),
        isNotNull(libraryImportJobsTable.bufferJson),
        gte(libraryImportJobsTable.startedAt, new Date(Date.now() - BUFFER_MAX_AGE_MS)),
      ))
      .orderBy(desc(libraryImportJobsTable.id))
      .limit(1);

    // Path 2: look for a job interrupted mid-fetch (partial buffer).
    const [prevInterrupted] = prevWithBuffer
      ? [undefined] // skip the second query — Path 1 takes priority
      : await db
          .select({
            id: libraryImportJobsTable.id,
            bufferJson: libraryImportJobsTable.bufferJson,
          })
          .from(libraryImportJobsTable)
          .where(and(
            eq(libraryImportJobsTable.userId, userId),
            eq(libraryImportJobsTable.service, service),
            ne(libraryImportJobsTable.id, jobId),
            eq(libraryImportJobsTable.phase, "fetching"),
            isNotNull(libraryImportJobsTable.bufferJson),
            gte(libraryImportJobsTable.startedAt, new Date(Date.now() - BUFFER_MAX_AGE_MS)),
          ))
          .orderBy(desc(libraryImportJobsTable.id))
          .limit(1);

    let buffer: ImportBufferEntry[];

    if (prevWithBuffer?.bufferJson?.length) {
      // ── Path 1: skip Spotify fetch — drain the complete stored buffer ──────
      buffer = [...prevWithBuffer.bufferJson];
      console.log(
        `[me/import] job=${jobId} skipping Spotify fetch — using complete buffer` +
        ` from job=${prevWithBuffer.id} (${buffer.length} tracks)`,
      );
      // Advance directly to the "spine" phase so progress reporting is accurate.
      // Store resumedFrom so the frontend can show "Resuming from previous
      // session…" instead of "Fetching your library…".
      await db
        .update(libraryImportJobsTable)
        .set({ phase: "spine", total: buffer.length, bufferJson: buffer, resumedFrom: prevWithBuffer.id })
        .where(eq(libraryImportJobsTable.id, jobId));
    } else {
      // ── Path 2 / fresh: fetch from Spotify (optionally resumed) ───────────
      const partialBuf = prevInterrupted?.bufferJson ?? [];
      buffer = [...partialBuf];
      const startOffset = buffer.length;
      if (startOffset > 0) {
        console.log(
          `[me/import] job=${jobId} resuming Spotify fetch from offset ${startOffset}` +
          ` (${buffer.length} tracks already buffered from interrupted job=${prevInterrupted!.id})`,
        );
      }

      await db
        .update(libraryImportJobsTable)
        .set({ phase: "fetching", total: startOffset })
        .where(eq(libraryImportJobsTable.id, jobId));

      let lastFetchStamp = startOffset;
      for await (const raw of connector.importLibrary(accessToken, startOffset)) {
        buffer.push({
          artist: raw.artist,
          title: raw.title,
          isrc: raw.isrc ?? null,
          durationMs: raw.durationMs ?? null,
          externalId: raw.externalId ?? `${raw.artist}\u001f${raw.title}`,
        });
        if (buffer.length - lastFetchStamp >= FETCH_STAMP_INTERVAL) {
          lastFetchStamp = buffer.length;
          // Checkpoint: persist partial buffer so a future import can resume
          // from this point even if we're rate-limited or the server restarts.
          await db
            .update(libraryImportJobsTable)
            .set({ total: buffer.length, bufferJson: buffer })
            .where(eq(libraryImportJobsTable.id, jobId));
        }
      }

      // Fetch complete — persist final buffer and advance phase.
      await db
        .update(libraryImportJobsTable)
        .set({ total: buffer.length, phase: "spine", bufferJson: buffer })
        .where(eq(libraryImportJobsTable.id, jobId));
    }

    const total = buffer.length;
    let resolved = 0;

    const provenance: LibraryItemProvenance = { kind: "import", service };

    // Track which buffer entries have already been resolved (by position).
    const matchedIdx = new Set<number>();
    // Subset of matchedIdx: entries that were actually resolved to a real MBID.
    // Entries added to matchedIdx for confirmed-miss negative-cache hits are NOT
    // added here because those tracks are still genuinely unresolved and should
    // appear as soft rows in the library.
    const resolvedMbidIdx = new Set<number>();

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
          try {
            await db
              .insert(libraryItemsTable)
              .values({ userId, mbid, provenance, addedAt: new Date() })
              .onConflictDoNothing();
            resolved++;
          } catch (insertErr) {
            // 23503 = FK violation: the recordings row was deleted between the
            // ISRC bulk-lookup and this insert (race condition).  The track is
            // genuinely resolved — don't demote it to a soft row.  Log and
            // continue so the rest of the job is unaffected.
            const pgCode = (insertErr as { code?: string }).code;
            if (pgCode !== "23503") throw insertErr;
            console.warn(
              `[me/import] Phase 1 FK violation for mbid=${mbid} isrc=${t.isrc} — ` +
              `recordings row gone between lookup and insert; excluding from soft rows`,
            );
          }
          matchedIdx.add(i);
          resolvedMbidIdx.add(i); // MBID confirmed via ISRC — exclude from soft rows even if insert failed
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
      // Negative cache hits (mbid = null) are added to matchedIdx to exclude
      // them from Phase 3 — they already failed MB on a previous run and
      // writing them to the cache preserved that fact so we don't retry.
      const indexToMbid = new Map<number, string>();
      for (const { t, i } of phase2Entries) {
        if (indexToMbid.has(i) || matchedIdx.has(i)) continue;
        // ISRC key first (stronger). get() returns undefined (no entry),
        // null (negative cache), or a string (positive hit).
        if (t.isrc) {
          const hit = cacheMap.get(isrcKey(t.isrc));
          if (hit) { indexToMbid.set(i, hit); continue; }
          if (hit === null) { matchedIdx.add(i); continue; } // confirmed miss
        }
        const hit = cacheMap.get(normalizeKey(t.artist, t.title));
        if (hit) { indexToMbid.set(i, hit); continue; }
        if (hit === null) matchedIdx.add(i); // confirmed miss — skip Phase 3
      }

      if (indexToMbid.size > 0) {
        // Build an index→track lookup so we can seed spine rows below.
        const idxToTrack = new Map(phase2Entries.map(({ t, i }) => [i, t]));

        for (const [idx, mbid] of indexToMbid) {
          // Seed the spine row if not already present — the resolution_cache
          // entry already confirmed this mbid is real; background enrichment
          // (links, genres, ISRC) will fill in the rest.
          const track = idxToTrack.get(idx);
          if (track) {
            await db
              .insert(recordingsTable)
              .values({
                mbid,
                title: track.title,
                artist: track.artist,
                ...(track.isrc ? { isrc: track.isrc } : {}),
              })
              .onConflictDoNothing();
          }
          try {
            await db
              .insert(libraryItemsTable)
              .values({ userId, mbid, provenance, addedAt: new Date() })
              .onConflictDoNothing();
            resolved++;
          } catch (insertErr) {
            // 23503 = FK violation: the recordings row was deleted between the
            // cache lookup and this insert (race condition).  The track is
            // genuinely resolved — don't demote it to a soft row.  Log and
            // continue so the rest of the job is unaffected.
            const pgCode = (insertErr as { code?: string }).code;
            if (pgCode !== "23503") throw insertErr;
            console.warn(
              `[me/import] Phase 2 FK violation for mbid=${mbid} — ` +
              `recordings row gone between cache lookup and insert; excluding from soft rows`,
            );
          }
          matchedIdx.add(idx);
          resolvedMbidIdx.add(idx); // positive cache hit — exclude from soft rows even if insert failed
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
    const PHASE3_BUDGET_MS = 90 * 60_000; // 90 minutes — enough for ~4 900 tracks at 1.1 s each
    const phase3StartMs = Date.now();

    // Consecutive-error tracking for 503 / network-failure back-off.
    // When MB is rate-limiting, we pause rather than burning the full budget
    // on 12 s timeouts.
    //
    // Two separate pieces of state:
    //   consecutiveErrors — counts unbroken error streak; resets to 0 after
    //     each backoff pause so the next breach gets its own fresh pause.
    //   mbDegraded — latching flag set when the first threshold breach fires.
    //     It persists across the post-backoff reset and is only cleared when
    //     MB delivers a clean definitive response (hit or confirmed null).
    //     This ensures the shorter PHASE3_HIGH_ERROR_TIMEOUT_MS stays active
    //     throughout the degraded period, not just within a single streak.
    let consecutiveErrors = 0;
    let currentBackoffMs = PHASE3_503_BACKOFF_BASE_MS;
    let mbDegraded = false;

    for (const { t, i } of phase3Entries) {
      // Hard wall-clock budget: stop gracefully rather than running forever.
      if (Date.now() - phase3StartMs > PHASE3_BUDGET_MS) {
        console.warn(
          `[me/import] Phase 3 budget (${PHASE3_BUDGET_MS / 1000}s) exceeded — ` +
            `marking import done with ${resolved}/${total} resolved`,
        );
        break;
      }

      // Use a shorter per-track timeout when MB is degraded (latching flag).
      // This remains active across multiple backoff cycles until MB recovers.
      const resolveTimeoutMs = mbDegraded
        ? PHASE3_HIGH_ERROR_TIMEOUT_MS
        : IMPORT_RESOLVE_TIMEOUT_MS;

      const controller = new AbortController();
      const timer = setTimeout(() => {
        console.warn(`[me/import] resolve timeout for "${t.title}" by "${t.artist}" — skipping`);
        controller.abort();
      }, resolveTimeoutMs);

      let mbid: string | null = null;
      // Tracks whether the resolver threw (MB network error, 503, etc.).
      // A thrown error is NOT a confirmed miss — the track may be in MB but
      // MB was temporarily unavailable. We must not write a negative cache
      // entry in that case or future imports skip the track forever.
      let resolveErrored = false;
      try {
        // Try ISRC first (one MB lookup, high confidence); fall back to text.
        if (t.isrc) {
          mbid = await mbResolver.resolveByIsrc(t.isrc, controller.signal);
        }
        if (!mbid && !controller.signal.aborted) {
          mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
        }
        // Definitive response (hit or confirmed null) — MB is healthy again.
        if (!controller.signal.aborted) {
          consecutiveErrors = 0;
          mbDegraded = false;
        }
      } catch {
        // resolveBy* threw — likely a MB 503 or network error, not a real miss.
        resolveErrored = true;
        consecutiveErrors++;
      } finally {
        clearTimeout(timer);
      }

      // Back-off when consecutive errors reach the threshold.  Pause, then
      // continue from the next track — the failing ones stay un-cached so the
      // off-peak retry scheduler can pick them up later.
      if (consecutiveErrors >= PHASE3_503_THRESHOLD) {
        mbDegraded = true; // latch: shorter timeout applies until MB recovers
        console.warn(
          `[me/import] job=${jobId} Phase 3 — ${consecutiveErrors} consecutive MB errors, ` +
          `pausing ${currentBackoffMs / 1000}s before continuing`,
        );
        // Signal the frontend that we're in a back-off pause so the progress
        // bar doesn't appear frozen.  Keep status="running" so polling
        // continues; clear the hint once we resume.
        await db
          .update(libraryImportJobsTable)
          .set({ total, resolved, error: "resolve:backoff" })
          .where(eq(libraryImportJobsTable.id, jobId));
        await sleep(currentBackoffMs);
        await db
          .update(libraryImportJobsTable)
          .set({ total, resolved, error: null })
          .where(eq(libraryImportJobsTable.id, jobId));
        currentBackoffMs = Math.min(currentBackoffMs * 2, PHASE3_503_MAX_BACKOFF_MS);
        consecutiveErrors = 0; // reset streak so the next breach gets its own pause
      }

      if (mbid) {
        // Seed the spine row if not already present — MB already confirmed
        // this mbid is real; enrichment (links, genres, ISRC check) fills
        // in the rest via background jobs.
        await db
          .insert(recordingsTable)
          .values({
            mbid,
            title: t.title,
            artist: t.artist,
            ...(t.isrc ? { isrc: t.isrc } : {}),
          })
          .onConflictDoNothing();

        try {
          await db
            .insert(libraryItemsTable)
            .values({ userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          resolved++;
        } catch (insertErr) {
          // 23503 = FK violation: the recordings row was deleted between the
          // MB resolve and this insert (race condition).  The track is
          // genuinely resolved — don't demote it to a soft row.  Log and
          // continue so the rest of the job is unaffected.
          const pgCode = (insertErr as { code?: string }).code;
          if (pgCode !== "23503") throw insertErr;
          console.warn(
            `[me/import] Phase 3 FK violation for mbid=${mbid} — ` +
            `recordings row gone between MB resolve and insert; excluding from soft rows`,
          );
        }
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
        // Mark as resolved so Phase 3 iteration and soft-row seeding exclude it.
        matchedIdx.add(i);
        resolvedMbidIdx.add(i); // positive MB hit — not a soft row
      } else if (!controller.signal.aborted && !resolveErrored) {
        // Confirmed MB miss (null return + no error + not timed out) — write
        // a negative cache entry so future imports skip this track in Phase 2
        // instead of burning another MB call on a genuine non-match.
        // onConflictDoNothing preserves any positive entry that enrichment may
        // have written for the same key in the meantime.
        await db
          .insert(resolutionCacheTable)
          .values([
            ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid: null }] : []),
            { key: normalizeKey(t.artist, t.title), mbid: null },
          ])
          .onConflictDoNothing()
          .catch(() => {});
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

    // ── Seed soft rows for unresolved tracks (Spotify only) ─────────────────
    // Every entry that Phase 1-3 could not match to an MBID is written to
    // spotify_library_items so the listener sees their whole library, not
    // just the ~55 % we could resolve.  A nightly retry pass will promote
    // any that MusicBrainz finally matches.
    if (service === "spotify") {
      // Use resolvedMbidIdx (not matchedIdx) so confirmed-miss negative-cache
      // entries (which are in matchedIdx but have no MBID) still appear as soft
      // rows — they are genuinely unresolved tracks the listener saved.
      const unresolvedEntries = buffer
        .map((t, i) => ({ t, i }))
        .filter(({ i }) => !resolvedMbidIdx.has(i))
        .map(({ t }) => t);
      if (unresolvedEntries.length > 0) {
        console.log(
          `[me/import] job=${jobId} seeding ${unresolvedEntries.length} unresolved tracks as soft rows`,
        );
        // Token may have expired during Phase 3 (up to 90 min) — refresh.
        const softToken = await getFreshToken(conn);
        await seedSpotifySoftRows(userId, softToken ?? "", unresolvedEntries);
      }
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
// Off-peak Phase 3 retry scheduler
// ---------------------------------------------------------------------------

/**
 * Runs once: finds completed import jobs where MB resolved fewer tracks than
 * fetched (total > resolved) and there are still un-cached entries (no row in
 * resolution_cache — meaning neither a positive hit nor a confirmed miss was
 * stored).  Those tracks were likely missed because MB was rate-limiting during
 * the original Phase 3 run.
 *
 * For each eligible user/service pair the function creates a new import job
 * that covers only the un-cached tracks, then runs a standalone Phase 3 loop.
 * No Spotify API calls are needed — the buffer from the original job is reused.
 *
 * Called from `startPhase3RetryScheduler` during off-peak hours only.
 */
export async function runPhase3RetryPass(deadline?: Date): Promise<void> {
  // Find the most recent completed import job per user/service that still has
  // unresolved tracks and a stored buffer (so we can derive the un-cached set).
  const cutoff = new Date(Date.now() - PHASE3_RETRY_MAX_JOB_AGE_MS);

  // Drizzle doesn't support DISTINCT ON — use a raw-ish approach: fetch
  // all eligible jobs ordered newest-first and keep the first per user+service.
  const candidates = await db
    .select({
      id: libraryImportJobsTable.id,
      userId: libraryImportJobsTable.userId,
      service: libraryImportJobsTable.service,
      total: libraryImportJobsTable.total,
      resolved: libraryImportJobsTable.resolved,
      bufferJson: libraryImportJobsTable.bufferJson,
      retryAttempts: libraryImportJobsTable.retryAttempts,
    })
    .from(libraryImportJobsTable)
    .where(
      and(
        eq(libraryImportJobsTable.status, "done"),
        eq(libraryImportJobsTable.retryExhausted, false),
        isNotNull(libraryImportJobsTable.bufferJson),
        sql`COALESCE(${libraryImportJobsTable.finishedAt}, ${libraryImportJobsTable.startedAt}) >= ${cutoff}`,
        sql`${libraryImportJobsTable.total} > ${libraryImportJobsTable.resolved}`,
      ),
    )
    .orderBy(desc(libraryImportJobsTable.id))
    .limit(100); // safety cap — one pass shouldn't fan out unboundedly

  // Deduplicate to the most recent job per (userId, service) pair.
  const seen = new Set<string>();
  const dedupedCandidates = candidates.filter((c) => {
    const k = `${c.userId}:${c.service}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (dedupedCandidates.length === 0) return;

  console.log(
    `[me/import/retry] off-peak pass: ${dedupedCandidates.length} candidate job(s) to check`,
  );

  let processedCount = 0;
  for (const candidate of dedupedCandidates) {
    // ── Window-deadline guard ────────────────────────────────────────────────
    // Stop the entire pass if we've crossed the off-peak window boundary so a
    // long-running pass cannot spill into business hours.
    if (deadline && Date.now() >= deadline.getTime()) {
      console.warn(
        `[me/import/retry] window deadline reached — stopping pass early ` +
        `(${processedCount} of ${dedupedCandidates.length} candidate(s) processed)`,
      );
      break;
    }

    const buffer = candidate.bufferJson;
    if (!buffer || buffer.length === 0) continue;

    // Determine which buffer entries are genuinely un-cached (no entry at all
    // in resolution_cache — neither positive nor negative).
    const keySet = new Set<string>();
    for (const t of buffer) {
      if (t.isrc) keySet.add(isrcKey(t.isrc));
      keySet.add(normalizeKey(t.artist, t.title));
    }
    const allKeys = [...keySet];
    const cachedRows = await db
      .select({ key: resolutionCacheTable.key })
      .from(resolutionCacheTable)
      .where(inArray(resolutionCacheTable.key, allKeys));
    const cachedKeySet = new Set(cachedRows.map((r) => r.key));

    // Un-cached = no cache row at all (positive OR negative) for any of the
    // track's keys.  This means the track hasn't been touched since the import.
    const uncachedEntries = buffer.filter((t) => {
      const hasIsrcCached = t.isrc ? cachedKeySet.has(isrcKey(t.isrc)) : false;
      const hasTextCached = cachedKeySet.has(normalizeKey(t.artist, t.title));
      return !hasIsrcCached && !hasTextCached;
    });

    if (uncachedEntries.length === 0) {
      console.log(
        `[me/import/retry] job=${candidate.id} user=${candidate.userId} — no un-cached tracks, skipping`,
      );
      continue;
    }

    console.log(
      `[me/import/retry] job=${candidate.id} user=${candidate.userId} — ` +
      `retrying ${uncachedEntries.length} un-cached track(s)`,
    );

    // Skip if a live import is already running for this user+service to avoid
    // concurrent Spotify or MB request races.
    const [activeJob] = await db
      .select({ id: libraryImportJobsTable.id })
      .from(libraryImportJobsTable)
      .where(
        and(
          eq(libraryImportJobsTable.userId, candidate.userId),
          eq(libraryImportJobsTable.service, candidate.service),
          inArray(libraryImportJobsTable.status, ["running", "pending"]),
        ),
      )
      .limit(1);
    if (activeJob) {
      console.log(
        `[me/import/retry] skipping user=${candidate.userId} — job=${activeJob.id} already running`,
      );
      continue;
    }

    // Create a dedicated retry job so progress is visible and errors are
    // recorded per-attempt, not silently swallowed.
    const [retryJob] = await db
      .insert(libraryImportJobsTable)
      .values({
        userId: candidate.userId,
        service: candidate.service,
        status: "running",
        phase: "resolve",
        total: uncachedEntries.length,
        resolved: 0,
        startedAt: new Date(),
      })
      .returning();

    if (!retryJob) continue;

    const retryJobId = retryJob.id;
    const provenance: LibraryItemProvenance = { kind: "import", service: candidate.service };
    let retryResolved = 0;

    // Track whether the retry pass encountered a hard MB failure (thrown error)
    // so we can distinguish "MB was down" from "MB confirmed no match".
    let retryPassFailed = false;

    try {
      const mbResolver = createMbResolver();
      const RETRY_BUDGET_MS = 30 * 60_000; // 30-minute budget per retry pass
      const retryStartMs = Date.now();

      let consecutiveErrors = 0;
      let currentBackoffMs = PHASE3_503_BACKOFF_BASE_MS;
      let mbDegraded = false;

      for (const t of uncachedEntries) {
        if (Date.now() - retryStartMs > RETRY_BUDGET_MS) {
          console.warn(
            `[me/import/retry] job=${retryJobId} 30-minute budget exceeded — ` +
            `resolved ${retryResolved}/${uncachedEntries.length}`,
          );
          break;
        }
        if (deadline && Date.now() >= deadline.getTime()) {
          console.warn(
            `[me/import/retry] job=${retryJobId} window deadline reached — ` +
            `stopping track loop (resolved ${retryResolved}/${uncachedEntries.length})`,
          );
          break;
        }

        const resolveTimeoutMs = mbDegraded
          ? PHASE3_HIGH_ERROR_TIMEOUT_MS
          : IMPORT_RESOLVE_TIMEOUT_MS;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolveTimeoutMs);

        let mbid: string | null = null;
        let resolveErrored = false;
        try {
          if (t.isrc) {
            mbid = await mbResolver.resolveByIsrc(t.isrc, controller.signal);
          }
          if (!mbid && !controller.signal.aborted) {
            mbid = await mbResolver.resolveByText(t.artist, t.title, controller.signal);
          }
          if (!controller.signal.aborted) {
            consecutiveErrors = 0;
            mbDegraded = false;
          }
        } catch {
          resolveErrored = true;
          consecutiveErrors++;
        } finally {
          clearTimeout(timer);
        }

        // Back off when MB is clearly struggling.
        if (consecutiveErrors >= PHASE3_503_THRESHOLD) {
          mbDegraded = true;
          console.warn(
            `[me/import/retry] job=${retryJobId} ${consecutiveErrors} consecutive MB errors — ` +
            `pausing ${currentBackoffMs / 1000}s`,
          );
          await sleep(currentBackoffMs);
          currentBackoffMs = Math.min(currentBackoffMs * 2, PHASE3_503_MAX_BACKOFF_MS);
          consecutiveErrors = 0;
        }

        if (mbid) {
          await db
            .insert(recordingsTable)
            .values({
              mbid,
              title: t.title,
              artist: t.artist,
              ...(t.isrc ? { isrc: t.isrc } : {}),
            })
            .onConflictDoNothing();
          await db
            .insert(libraryItemsTable)
            .values({ userId: candidate.userId, mbid, provenance, addedAt: new Date() })
            .onConflictDoNothing();
          await db
            .insert(resolutionCacheTable)
            .values([
              ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid }] : []),
              { key: normalizeKey(t.artist, t.title), mbid },
            ])
            .onConflictDoNothing()
            .catch(() => {});
          // Promote: remove the soft row now that library_items has the track.
          if (candidate.service === "spotify") {
            // A real Spotify track ID is always 22 alphanumeric characters.
            // When no ID was available during the original import, the buffer
            // entry was seeded with a synthesised "artist\u001ftitle" fallback
            // key.  The soft row in spotify_library_items may carry that same
            // synthesised key (or may have been inserted under a different value
            // in a prior run), so the spotifyId match alone is unreliable.
            // Fall back to ISRC (most precise) or artist+title when the
            // externalId is not a genuine Spotify track ID.
            const isRealSpotifyId = /^[A-Za-z0-9]{22}$/.test(t.externalId);
            if (isRealSpotifyId) {
              await db
                .delete(spotifyLibraryItemsTable)
                .where(
                  and(
                    eq(spotifyLibraryItemsTable.userId, candidate.userId),
                    eq(spotifyLibraryItemsTable.spotifyId, t.externalId),
                  ),
                )
                .catch(() => {});
            } else {
              // Synthesised-key path: match by ISRC if present, otherwise by
              // artist + title.  Both are already available on the buffer entry
              // and were written to the soft row when it was seeded.
              //
              // When an ISRC is available we also OR in (isrc IS NULL AND
              // artist+title) so that a pre-existing real-Spotify-ID soft row
              // whose isrc column is NULL (e.g. the Spotify API did not return
              // an ISRC for that track) is also removed.  The IS NULL guard is
              // essential: without it, rows carrying a *different* non-null ISRC
              // (edit/remaster/live variant sharing artist+title) would be
              // incorrectly deleted.
              const artistTitleCond = and(
                eq(spotifyLibraryItemsTable.artist, t.artist),
                eq(spotifyLibraryItemsTable.title, t.title),
              );
              const fallbackCond = t.isrc
                ? or(
                    eq(spotifyLibraryItemsTable.isrc, t.isrc),
                    and(isNull(spotifyLibraryItemsTable.isrc), artistTitleCond),
                  )
                : artistTitleCond;
              await db
                .delete(spotifyLibraryItemsTable)
                .where(and(eq(spotifyLibraryItemsTable.userId, candidate.userId), fallbackCond))
                .catch(() => {});
            }
          }
          retryResolved++;
        } else if (!controller.signal.aborted && !resolveErrored) {
          // Confirmed MB miss — write negative cache so future runs skip it.
          await db
            .insert(resolutionCacheTable)
            .values([
              ...(t.isrc ? [{ key: isrcKey(t.isrc), mbid: null }] : []),
              { key: normalizeKey(t.artist, t.title), mbid: null },
            ])
            .onConflictDoNothing()
            .catch(() => {});
        }

        if (!controller.signal.aborted) {
          await sleep(IMPORT_RESOLVE_DELAY_MS);
        }

        await db
          .update(libraryImportJobsTable)
          .set({ resolved: retryResolved })
          .where(eq(libraryImportJobsTable.id, retryJobId));
      }

      await db
        .update(libraryImportJobsTable)
        .set({ status: "done", resolved: retryResolved, finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, retryJobId));

      console.log(
        `[me/import/retry] job=${retryJobId} complete — ` +
        `resolved ${retryResolved}/${uncachedEntries.length}`,
      );
    } catch (err) {
      retryPassFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[me/import/retry] job=${retryJobId} failed`, err);
      await db
        .update(libraryImportJobsTable)
        .set({ status: "error", error: message.slice(0, 500), finishedAt: new Date() })
        .where(eq(libraryImportJobsTable.id, retryJobId))
        .catch(() => {});
    }

    // ── Update retry-exhaustion state on the source job ──────────────────────
    // A pass is "successful" when it resolves at least one previously un-cached
    // track. Anything else — zero resolved, thrown error, budget exceeded — is
    // a failed attempt. After PHASE3_MAX_RETRY_ATTEMPTS consecutive failures the
    // source job is marked exhausted and dropped from all future passes.
    //
    // We do NOT count toward exhaustion when the pass threw a hard MB error,
    // because the failure is infrastructure-level not a definitive "not in MB".
    // However we do count budget-exceeded (retryResolved === 0 && !failed) as
    // a failed attempt: if a retry pass keeps running out of time it's unlikely
    // to make progress on subsequent nights either.
    if (retryResolved > 0) {
      // Success: reset the counter and clear the exhausted flag.
      await db
        .update(libraryImportJobsTable)
        .set({ retryAttempts: 0, retryExhausted: false })
        .where(eq(libraryImportJobsTable.id, candidate.id))
        .catch(() => {});
      console.log(
        `[me/import/retry] source job=${candidate.id} retry counter reset (resolved ${retryResolved})`,
      );
    } else if (!retryPassFailed) {
      // Zero resolved, no hard failure: count as a failed attempt.
      const newAttempts = (candidate.retryAttempts ?? 0) + 1;
      const nowExhausted = newAttempts >= PHASE3_MAX_RETRY_ATTEMPTS;
      await db
        .update(libraryImportJobsTable)
        .set({
          retryAttempts: newAttempts,
          ...(nowExhausted ? { retryExhausted: true } : {}),
        })
        .where(eq(libraryImportJobsTable.id, candidate.id))
        .catch(() => {});
      if (nowExhausted) {
        console.warn(
          `[me/import/retry] source job=${candidate.id} marked retry_exhausted ` +
          `after ${newAttempts} consecutive failed passes`,
        );
      } else {
        console.log(
          `[me/import/retry] source job=${candidate.id} failed attempt ${newAttempts}/${PHASE3_MAX_RETRY_ATTEMPTS}`,
        );
      }
    }
    // If retryPassFailed (hard MB error), do NOT increment retryAttempts —
    // MB being down is not the track's fault; we want to retry again tomorrow.

    processedCount++;
  }
}

/**
 * Starts the recurring Phase 3 off-peak retry scheduler.
 *
 * Wakes up every PHASE3_RETRY_POLL_MS (15 min) and runs a retry pass only
 * when the current UTC hour falls within PHASE3_RETRY_OFF_PEAK_HOURS (2–6 AM).
 * During business hours the scheduler is a no-op — it fires but immediately
 * returns, adding no load.
 *
 * An in-flight guard ensures that if a pass takes longer than the poll interval
 * (e.g. many unresolved tracks with 1.1 s sleeps), the next tick is skipped
 * rather than launching a second concurrent pass that would defeat the
 * rate-limit protection and double the DB load.
 *
 * Called from the boot entrypoint (src/index.ts) so it never runs during
 * tests or non-worker module imports.
 */
export function startPhase3RetryScheduler(): void {
  let passInFlight = false;

  setInterval(() => {
    const utcHour = new Date().getUTCHours();
    const [start, end] = PHASE3_RETRY_OFF_PEAK_HOURS;
    if (utcHour < start || utcHour >= end) return;
    if (passInFlight) {
      console.log("[me/import/retry] previous pass still running — skipping tick");
      return;
    }
    passInFlight = true;
    // Compute the hard deadline as the UTC end-of-window (e.g. 06:00:00 UTC).
    // If the wall-clock is already past it (shouldn't happen given the gate
    // above, but be defensive), pass undefined so the pass runs normally.
    const [, windowEnd] = PHASE3_RETRY_OFF_PEAK_HOURS;
    const nowForDeadline = new Date();
    const windowEndDate = new Date(nowForDeadline);
    windowEndDate.setUTCHours(windowEnd, 0, 0, 0);
    const passDeadline = windowEndDate > nowForDeadline ? windowEndDate : undefined;
    runPhase3RetryPass(passDeadline)
      .catch((err) => console.error("[me/import/retry] scheduler pass failed", err))
      .finally(() => { passInFlight = false; });
  }, PHASE3_RETRY_POLL_MS);
  console.log("[me/import/retry] off-peak retry scheduler started (active 02–06 UTC)");
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
 * Unions `library_items` (MBID-resolved) and `spotify_library_items`
 * (unresolved soft rows) so the listener sees their whole Spotify library,
 * not just the ~55 % that resolved to MusicBrainz.
 *
 * Query params:
 * - `sort`  — "added" (default, newest first) | "artist" | "title" (A→Z).
 * - `q`     — case-insensitive substring match on title or artist.
 * - `source`— "keep" | "import" (provenance.kind filter).
 *             Soft rows are hidden under "keep" (they are import-provenance).
 * - `cursor`— keyset cursor. For sort=added it's the last row's addedAt ISO;
 *   for name sorts it's `<sortKey>\u001f<mbid>` (resolved rows) or
 *   `<sortKey>\u001f` (soft rows at the end of page 1).
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
  const source: "keep" | "import" | "soft" | "critic" | null =
    sourceRaw === "keep" || sourceRaw === "import" || sourceRaw === "soft" || sourceRaw === "critic" ? sourceRaw : null;

  // "soft"   → only spotify_library_items rows (unresolved, no MBID yet).
  // "keep"   → only library_items with provenance.kind='keep', no soft rows.
  // "import" → library_items with provenance.kind='import' + soft rows.
  // "critic" → only library_items whose album appears in at least one confirmed list entry; no soft rows.
  // null     → all resolved + soft rows.
  const includeSoft = source !== "keep" && source !== "critic";
  const includeResolved = source !== "soft";

  // ── Resolved rows conditions ─────────────────────────────────────────────
  const conditions = [eq(libraryItemsTable.userId, user.id)];

  if (q.length > 0) {
    const pattern = `%${escapeLike(q)}%`;
    conditions.push(
      sql`(${recordingsTable.title} ILIKE ${pattern} OR ${recordingsTable.artist} ILIKE ${pattern})`,
    );
  }
  if (source && source !== "critic") {
    conditions.push(
      sql`${libraryItemsTable.provenance}->>'kind' = ${source}`,
    );
  }
  if (source === "critic") {
    // Filter to recordings whose primary release group has at least one confirmed list entry.
    conditions.push(
      sql`EXISTS (
        SELECT 1
        FROM recording_release_groups rrg
        JOIN list_entries le ON le.release_group_mbid = rrg.release_group_mbid
        WHERE rrg.recording_mbid = ${libraryItemsTable.mbid}
          AND (le.confidence = 'exact' OR le.confirmed = true)
      )`,
    );
  }

  // ── Total count (page 1 only) — sum of resolved + soft ──────────────────
  let total: number | undefined;
  // keepCount: always the full radio-keep count regardless of current source/q
  // filter, so the hero stat is accurate even when the user has a filter active.
  let keepCount: number | undefined;
  // softCount: live count of unresolved rows — returned on page 1 so the client
  // can gate the "Not in MusicBrainz" button on the real current count rather
  // than the stale import-job totals (retry passes resolve more tracks later).
  let softCount: number | undefined;
  // criticCount: live count of library items whose album appears in at least one
  // confirmed list entry — always counted regardless of the active source/q filter
  // so the hero stat is stable even when a different filter is active.
  let criticCount: number | undefined;
  if (!cursor) {
    const [resolvedCount, rawSoftCount, rawKeepCount, rawCriticCount] = await Promise.all([
      includeResolved
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(libraryItemsTable)
            .leftJoin(recordingsTable, eq(libraryItemsTable.mbid, recordingsTable.mbid))
            .where(and(...conditions))
            .then((r) => r[0]?.count ?? 0)
        : Promise.resolve(0),
      includeSoft
        ? (async () => {
            const softConds = [
              eq(spotifyLibraryItemsTable.userId, user.id),
              isNull(spotifyLibraryItemsTable.mbid),
            ];
            if (q.length > 0) {
              const pattern = `%${escapeLike(q)}%`;
              softConds.push(
                sql`(${spotifyLibraryItemsTable.title} ILIKE ${pattern} OR ${spotifyLibraryItemsTable.artist} ILIKE ${pattern})`,
              );
            }
            return db
              .select({ count: sql<number>`count(*)::int` })
              .from(spotifyLibraryItemsTable)
              .where(and(...softConds))
              .then((r) => r[0]?.count ?? 0);
          })()
        : Promise.resolve(0),
      // Radio keeps — always counted regardless of active source/q filter so the
      // hero stat is stable and doesn't disappear when a different filter is active.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, user.id),
            sql`${libraryItemsTable.provenance}->>'kind' = 'keep'`,
          ),
        )
        .then((r) => r[0]?.count ?? 0),
      // Critic picks — library items whose album has at least one confirmed list
      // entry; always counted regardless of active source/q filter.
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(libraryItemsTable)
        .where(
          and(
            eq(libraryItemsTable.userId, user.id),
            sql`EXISTS (
              SELECT 1
              FROM recording_release_groups rrg
              JOIN list_entries le ON le.release_group_mbid = rrg.release_group_mbid
              WHERE rrg.recording_mbid = ${libraryItemsTable.mbid}
                AND (le.confidence = 'exact' OR le.confirmed = true)
            )`,
          ),
        )
        .then((r) => r[0]?.count ?? 0),
    ]);
    softCount = rawSoftCount;
    total = resolvedCount + softCount;
    keepCount = rawKeepCount;
    criticCount = rawCriticCount;
  }

  // Sort key expression for resolved rows (name sorts).
  const sortKeyExpr =
    sort === "artist"
      ? sql<string>`lower(coalesce(${recordingsTable.artist}, '') || ' ' || coalesce(${recordingsTable.title}, ''))`
      : sql<string>`lower(coalesce(${recordingsTable.title}, '') || ' ' || coalesce(${recordingsTable.artist}, ''))`;

  // ── Soft rows base conditions (shared; cursor applied below) ────────────
  const softConds = [
    eq(spotifyLibraryItemsTable.userId, user.id),
    isNull(spotifyLibraryItemsTable.mbid),
  ];
  if (q.length > 0) {
    const pattern = `%${escapeLike(q)}%`;
    softConds.push(
      sql`(${spotifyLibraryItemsTable.title} ILIKE ${pattern} OR ${spotifyLibraryItemsTable.artist} ILIKE ${pattern})`,
    );
  }

  // Sort-key expression for soft rows (name sorts).
  const softSortKeyExpr =
    sort === "artist"
      ? sql<string>`lower(coalesce(${spotifyLibraryItemsTable.artist}, '') || ' ' || coalesce(${spotifyLibraryItemsTable.title}, ''))`
      : sql<string>`lower(coalesce(${spotifyLibraryItemsTable.title}, '') || ' ' || coalesce(${spotifyLibraryItemsTable.artist}, ''))`;

  // ── Cursor decoding and per-table conditions ─────────────────────────────
  // Cursor format (all sorts):
  //   sort=added  → addedAt ISO string  (e.g. "2026-07-31T12:00:00.000Z")
  //   sort=name   → "sortKey\x1faddedAt" (ISO timestamp tiebreak — works for
  //                 both resolved and soft rows since both tables have addedAt)
  //
  // Backward compat: cursors generated before this change used "sortKey\x1fmbid"
  // (UUID tiebreak, resolved-only).  Detect by testing whether the suffix
  // looks like an ISO date; if not, treat it as the old mbid format and show
  // soft rows from the beginning (no cursor applied to soft table).
  let legacyNameCursor = false;
  if (cursor) {
    if (sort === "added") {
      conditions.push(sql`${libraryItemsTable.addedAt} < ${cursor}::timestamptz`);
      softConds.push(sql`${spotifyLibraryItemsTable.addedAt} < ${cursor}::timestamptz`);
    } else {
      const sep = cursor.lastIndexOf(LIB_CURSOR_SEP);
      if (sep < 0) {
        return res.status(400).json({ error: "Malformed cursor for this sort" });
      }
      const keyPart = cursor.slice(0, sep);
      const suffixPart = cursor.slice(sep + 1);
      // ISO date starts with "20" (e.g. 2026-…); UUID tiebreaks do not.
      const isAddedAtSuffix = /^\d{4}-\d{2}-\d{2}T/.test(suffixPart);
      if (isAddedAtSuffix) {
        // New format: (sortKey, addedAt) tuple keyset — works for both tables.
        conditions.push(
          sql`(${sortKeyExpr}, ${libraryItemsTable.addedAt}) > (${keyPart}, ${suffixPart}::timestamptz)`,
        );
        softConds.push(
          sql`(${softSortKeyExpr}, ${spotifyLibraryItemsTable.addedAt}) > (${keyPart}, ${suffixPart}::timestamptz)`,
        );
      } else {
        // Legacy format: (sortKey, mbid) — resolved rows only; show all soft
        // rows again from the top (they were skipped in old sessions).
        conditions.push(
          sql`(${sortKeyExpr}, ${libraryItemsTable.mbid}) > (${keyPart}, ${suffixPart})`,
        );
        legacyNameCursor = true;
      }
    }
  }

  // ── Resolved rows query ──────────────────────────────────────────────────
  // Skipped entirely when source=soft (only unresolved tracks requested).
  type ResolvedRow = {
    mbid: string; provenance: LibraryItemProvenance; addedAt: Date;
    title: string | null; artist: string | null; artworkUrl: string | null;
    links: Array<{ url: string }> | null; sortKey: string; albumTitle: string | null;
  };
  let resolvedRows: ResolvedRow[] = [];
  if (includeResolved) resolvedRows = await db
    .select({
      mbid: libraryItemsTable.mbid,
      provenance: libraryItemsTable.provenance,
      addedAt: libraryItemsTable.addedAt,
      title: recordingsTable.title,
      artist: recordingsTable.artist,
      artworkUrl: recordingsTable.artworkUrl,
      links: recordingsTable.links,
      sortKey: sortKeyExpr.as("sort_key"),
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
        : [asc(sortKeyExpr), asc(libraryItemsTable.addedAt)]),
    )
    .limit(limit + 1);

  // ── Soft rows query ───────────────────────────────────────────────────────
  // Included for all pages for all sort modes (both tables use addedAt cursor).
  // Exception: legacy name-sort cursors (old format) always include all soft
  // rows since those sessions never applied a cursor to the soft table.
  // legacyNameCursor is set but unused in the soft query because the legacy
  // code path never pushed a cursor condition into softConds, so softConds
  // already has the right (no-cursor) state for that case.
  void legacyNameCursor;

  type SoftRow = { spotifyId: string; addedAt: Date; title: string; artist: string; artworkUrl: string | null; albumName: string | null; sortKey: string };
  let softRows: SoftRow[] = [];
  if (includeSoft) {
    softRows = await db
      .select({
        spotifyId: spotifyLibraryItemsTable.spotifyId,
        addedAt: spotifyLibraryItemsTable.addedAt,
        title: spotifyLibraryItemsTable.title,
        artist: spotifyLibraryItemsTable.artist,
        artworkUrl: spotifyLibraryItemsTable.artworkUrl,
        albumName: spotifyLibraryItemsTable.albumName,
        sortKey: softSortKeyExpr.as("soft_sort_key"),
      })
      .from(spotifyLibraryItemsTable)
      .where(and(...softConds))
      .orderBy(
        ...(sort === "added"
          ? [desc(spotifyLibraryItemsTable.addedAt)]
          : [asc(softSortKeyExpr), asc(spotifyLibraryItemsTable.addedAt)]),
      )
      .limit(limit + 1);
  }

  // ── Merge resolved + soft in JS ───────────────────────────────────────────
  const softProvenance: LibraryItemProvenance = { kind: "import", service: "spotify" };

  const unified = [
    ...resolvedRows.map((r) => ({
      soft: false as const,
      mbid: r.mbid as string | null,
      spotifyId: null as string | null,
      provenance: r.provenance,
      addedAt: r.addedAt,
      title: r.title,
      artist: r.artist,
      artworkUrl: r.artworkUrl,
      links: r.links as Array<{ url: string }> | null,
      albumTitle: r.albumTitle,
      sortKey: r.sortKey,
    })),
    ...softRows.map((s) => ({
      soft: true as const,
      mbid: null as string | null,
      spotifyId: s.spotifyId,
      provenance: softProvenance,
      addedAt: s.addedAt,
      title: s.title,
      artist: s.artist,
      artworkUrl: s.artworkUrl,
      links: null as Array<{ url: string }> | null,
      albumTitle: s.albumName,
      sortKey: s.sortKey,
    })),
  ];

  if (sort === "added") {
    unified.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  } else {
    unified.sort(
      (a, b) =>
        a.sortKey.localeCompare(b.sortKey) ||
        a.addedAt.getTime() - b.addedAt.getTime(),
    );
  }

  const hasMore = unified.length > limit;
  const items = unified.slice(0, limit);
  const last = items[items.length - 1];

  // Build cursor.
  // sort=added  → addedAt ISO string (works for both tables).
  // sort=name   → "sortKey\x1faddedAt" (new unified format for both tables).
  const nextCursor = !hasMore || !last
    ? null
    : sort === "added"
      ? last.addedAt.toISOString()
      : `${last.sortKey}${LIB_CURSOR_SEP}${last.addedAt.toISOString()}`;

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
              r.links?.find((l) => l.url.includes("open.spotify.com"))?.url ?? null,
          }
        : null,
      ...(r.soft ? { soft: true, spotifyId: r.spotifyId } : {}),
    })),
    nextCursor,
    ...(total !== undefined ? { total } : {}),
    ...(keepCount !== undefined ? { keepCount } : {}),
    ...(softCount !== undefined ? { softCount } : {}),
    ...(criticCount !== undefined ? { criticCount } : {}),
  });
}));

/**
 * GET /api/me/library/mbids — all resolved MBIDs in the user's library,
 * returned as a flat string array, plus the set of release-group MBIDs that
 * span all library recordings (for album-level crossing detection on the dial).
 * No pagination — this is a lightweight crossing-detection endpoint.
 * Unauthenticated → 200 { mbids: [], releaseGroupMbids: [] }.
 */
router.get("/me/library/mbids", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (!user) { res.json({ mbids: [], releaseGroupMbids: [], artistMbids: [] }); return; }

  const rows = await db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.userId, user.id), isNotNull(libraryItemsTable.mbid)));

  const mbids = rows.map((r) => r.mbid).filter((m): m is string => !!m);

  // Expand to release groups so the dial can match any track from an owned album.
  let releaseGroupMbids: string[] = [];
  let artistMbids: string[] = [];
  if (mbids.length > 0) {
    const [rgRows, artistRows] = await Promise.all([
      db.selectDistinct({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
        .from(recordingReleaseGroupsTable)
        .where(inArray(recordingReleaseGroupsTable.recordingMbid, mbids)),
      // Artist MBIDs: let the dial fire on any track by a library artist,
      // not just exact recordings. Widens crossing detection significantly.
      db.selectDistinct({ artistMbid: recordingsTable.artistMbid })
        .from(recordingsTable)
        .where(and(inArray(recordingsTable.mbid, mbids), isNotNull(recordingsTable.artistMbid))),
    ]);
    releaseGroupMbids = rgRows.map((r) => r.releaseGroupMbid);
    artistMbids = artistRows.map((r) => r.artistMbid).filter((m): m is string => !!m);
  }

  // Soft-row artists: stations that play any track by a library artist
  // (without an MBID match) still get an isArtistHit on the dial.
  let softArtists: string[] = [];
  {
    const softRows = await db
      .selectDistinct({ artist: spotifyLibraryItemsTable.artist })
      .from(spotifyLibraryItemsTable)
      .where(
        and(
          eq(spotifyLibraryItemsTable.userId, user.id),
          isNull(spotifyLibraryItemsTable.mbid),
        ),
      );
    softArtists = softRows.map((r) => r.artist).filter(Boolean);
  }

  res.json({ mbids, releaseGroupMbids, artistMbids, softArtists });
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

  // Include listen history in the JSON export when the user has ledger enabled.
  let listenExportRows: ListenExportRow[] | undefined;
  if (format === "json" && user.ledgerEnabled) {
    const listenRows = await db
      .select({
        id: listensTable.id,
        mbid: listensTable.mbid,
        title: recordingsTable.title,
        artist: recordingsTable.artist,
        stationName: stationsTable.name,
        pickerName: pickersTable.name,
        showName: showsTable.name,
        context: listensTable.context,
        outputService: listensTable.outputService,
        startedAt: listensTable.startedAt,
        msPlayed: listensTable.msPlayed,
        completed: listensTable.completed,
      })
      .from(listensTable)
      .leftJoin(recordingsTable, eq(listensTable.mbid, recordingsTable.mbid))
      .leftJoin(stationsTable, eq(listensTable.stationId, stationsTable.id))
      .leftJoin(pickersTable, eq(listensTable.pickerId, pickersTable.id))
      .leftJoin(showsTable, eq(listensTable.showId, showsTable.id))
      .where(eq(listensTable.userId, user.id))
      .orderBy(desc(listensTable.startedAt))
      .limit(EXPORT_MAX_ROWS);

    listenExportRows = listenRows.map((l) => ({
      id: l.id,
      mbid: l.mbid,
      title: l.title ?? null,
      artist: l.artist ?? null,
      stationName: l.stationName ?? null,
      pickerName: l.pickerName ?? null,
      showName: l.showName ?? null,
      context: l.context,
      outputService: l.outputService,
      startedAt: l.startedAt,
      msPlayed: l.msPlayed,
      completed: l.completed,
    }));
  }

  const now = new Date();
  const body = buildExport(format, exportRows, now, listenExportRows);
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

    // Show the recovery hint once — when this keep brings the total to exactly 3.
    const [spinLibCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(libraryItemsTable)
      .where(eq(libraryItemsTable.userId, user.id));
    const [spinPendingCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(pendingKeepsTable)
      .where(and(eq(pendingKeepsTable.userId, user.id), isNull(pendingKeepsTable.promotedAt)));
    const showRecoveryHint = ((spinLibCount?.n ?? 0) + (spinPendingCount?.n ?? 0)) === 3;

    return res.json({ keptToLore: promotedAt != null, pendingKept: true, mirrors: [], showRecoveryHint });
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

  // Show the recovery hint once — when this keep brings the total to exactly 3.
  const [libCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));
  const [pendingCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pendingKeepsTable)
    .where(and(eq(pendingKeepsTable.userId, user.id), isNull(pendingKeepsTable.promotedAt)));
  const showRecoveryHint = ((libCount?.n ?? 0) + (pendingCount?.n ?? 0)) === 3;

  return res.json({ keptToLore: true, mirrors, showRecoveryHint });
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
 * GET /api/me/ghost/missed — stations that played the user's library artists
 * in the rolling 24 h window but that the user has never consciously tuned
 * into (no listens record for that station).
 *
 * Join path: library_items → recordings (artist_mbid) → spins (24 h) →
 * stations.  Excludes stations with any listens row for this user.
 * Returns at most 20 stations ordered by sort_order, name.
 */
router.get("/me/ghost/missed", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  type GhostRow = {
    station_id: number;
    slug: string;
    name: string;
    stream_url: string;
    stream_format: string;
    mode: string;
    attribution: boolean;
    artist_name: string;
  };

  const rows = await db.execute<GhostRow>(sql`
    WITH lib_artists AS (
      SELECT DISTINCT r.artist_mbid
      FROM library_items li
      JOIN recordings r ON li.mbid = r.mbid
      WHERE li.user_id = ${user.id}
        AND r.artist_mbid IS NOT NULL
    ),
    heard_stations AS (
      SELECT DISTINCT station_id
      FROM listens
      WHERE user_id = ${user.id}
        AND station_id IS NOT NULL
    ),
    ghost_candidates AS (
      SELECT DISTINCT ON (s.station_id)
        s.station_id,
        r.artist AS artist_name
      FROM spins s
      JOIN recordings r ON s.mbid = r.mbid
      JOIN lib_artists la ON r.artist_mbid = la.artist_mbid
      WHERE s.played_at >= NOW() - INTERVAL '24 hours'
      ORDER BY s.station_id, s.played_at DESC
    )
    SELECT
      st.id             AS station_id,
      st.slug,
      st.name,
      st.stream_url,
      st.stream_format,
      st.mode,
      st.attribution,
      gc.artist_name
    FROM ghost_candidates gc
    JOIN stations st ON gc.station_id = st.id
    LEFT JOIN heard_stations hs ON hs.station_id = st.id
    WHERE st.active = true
      AND st.hidden = false
      AND hs.station_id IS NULL
    ORDER BY st.sort_order, st.name
    LIMIT 20
  `);

  return res.json({
    stations: rows.rows.map((r) => ({
      stationId: r.station_id,
      slug: r.slug,
      name: r.name,
      streamUrl: r.stream_url,
      streamFormat: r.stream_format ?? "aac",
      mode: r.mode ?? "live",
      attribution: r.attribution ?? true,
      artistName: r.artist_name,
    })),
  });
}));

/**
 * GET /api/me/library/list-coverage — publication lists that feature albums
 * from the user's library. Only exact/confirmed list_entries are returned.
 * Results are grouped by list (listId → albums) in the response shape.
 */
router.get("/me/library/list-coverage", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;

  const rows = await db
    .select({
      listId: listsTable.id,
      listTitle: listsTable.title,
      listUrl: listsTable.url,
      listYear: listsTable.year,
      listKind: listsTable.kind,
      isRanked: listsTable.isRanked,
      sourceName: listSourcesTable.name,
      rank: listEntriesTable.rank,
      releaseGroupMbid: listEntriesTable.releaseGroupMbid,
      albumTitle: recordingReleaseGroupsTable.title,
      releaseYear: recordingReleaseGroupsTable.releaseYear,
    })
    .from(libraryItemsTable)
    .innerJoin(
      recordingReleaseGroupsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .innerJoin(
      listEntriesTable,
      eq(listEntriesTable.releaseGroupMbid, recordingReleaseGroupsTable.releaseGroupMbid),
    )
    .innerJoin(listsTable, eq(listsTable.id, listEntriesTable.listId))
    .innerJoin(listSourcesTable, eq(listSourcesTable.id, listsTable.sourceId))
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        isNotNull(libraryItemsTable.mbid),
        sql`(${listEntriesTable.confidence} = 'exact' OR ${listEntriesTable.confirmed} = true)`,
      ),
    )
    .orderBy(
      asc(listSourcesTable.name),
      sql`${listsTable.year} desc nulls last`,
      sql`${listEntriesTable.rank} asc nulls last`,
    );

  // Group by listId, deduplicating albums that appear via multiple recordings.
  const listMap = new Map<
    number,
    {
      listId: number;
      listTitle: string;
      listUrl: string;
      listYear: number | null;
      listKind: string;
      isRanked: boolean;
      sourceName: string;
      albums: Array<{
        releaseGroupMbid: string;
        albumTitle: string | null;
        releaseYear: number | null;
        rank: number | null;
      }>;
    }
  >();
  const seenAlbums = new Set<string>();

  for (const r of rows) {
    const albumKey = `${r.listId}:${r.releaseGroupMbid}`;
    if (seenAlbums.has(albumKey)) continue;
    seenAlbums.add(albumKey);

    let entry = listMap.get(r.listId);
    if (!entry) {
      entry = {
        listId: r.listId,
        listTitle: r.listTitle,
        listUrl: r.listUrl,
        listYear: r.listYear ?? null,
        listKind: r.listKind,
        isRanked: r.isRanked,
        sourceName: r.sourceName,
        albums: [],
      };
      listMap.set(r.listId, entry);
    }
    entry.albums.push({
      releaseGroupMbid: r.releaseGroupMbid,
      albumTitle: r.albumTitle ?? null,
      releaseYear: r.releaseYear ?? null,
      rank: r.rank ?? null,
    });
  }

  return res.json({ items: Array.from(listMap.values()) });
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
 * GET /api/me/overlaps/selectors — DJ selectors (radio pickers) ranked by how
 * many of the caller's library recordings they have ever aired.  Mirrors
 * /overlaps/pickers but targets pickerType = 'dj' and uses the picks table
 * (DJ show picks are ingested there the same as curated picks).
 */
router.get("/me/overlaps/selectors", h(async (req, res) => {
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
      sharedCount: sharedExpr,
    })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        eq(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, userLib),
        pickerNotOptedOut(pickersTable.id),
      ),
    )
    .groupBy(pickersTable.id, pickersTable.name, pickersTable.handle)
    .orderBy(sql`count(distinct ${picksTable.mbid}) desc`, asc(pickersTable.name))
    .limit(500);

  return res.json({
    items: rows.map((r) => ({
      selector: { name: r.name, handle: r.handle },
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

  // Zombie-reset: a stuck job is one that's older than ZOMBIE_AGE_MS with no
  // active worker (the process must have been restarted). If it has committed
  // matching progress, resume it rather than losing the work.
  const ZOMBIE_AGE_MS = SYNC_ZOMBIE_AGE_MS;
  const [existingJob] = await db
    .select({
      id: librarySyncJobsTable.id,
      status: librarySyncJobsTable.status,
      startedAt: librarySyncJobsTable.startedAt,
      committedOffset: librarySyncJobsTable.committedOffset,
    })
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
      if (existingJob.committedOffset > 0) {
        // Has committed matching progress — resume it rather than starting over.
        // But first confirm the token is still refreshable: if the user
        // disconnected Spotify while the server was down the job would spin
        // forever until the next poll surfaces the error.
        const freshToken = await getFreshToken(conn);
        if (!freshToken) {
          await db
            .update(librarySyncJobsTable)
            .set({ status: "error", error: "Spotify token expired or revoked — please reconnect Spotify and sync again", finishedAt: new Date() })
            .where(eq(librarySyncJobsTable.id, existingJob.id));
          console.warn(`[me/sync] job=${existingJob.id} token refresh failed during zombie-resume — marked error`);
          // Fall through so a new job is created once the user reconnects.
        } else {
          console.log(
            `[me/sync] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) ` +
            `but has committedOffset=${existingJob.committedOffset} — resuming`,
          );
          setImmediate(() => runSyncWorker(existingJob.id, user.id, conn, existingJob.committedOffset));
          return res.status(202).json({ jobId: existingJob.id, status: "running" });
        }
      } else {
        // No committed progress — reset so the user can start fresh.
        console.warn(`[me/sync] job=${existingJob.id} orphaned (${Math.round(ageMs / 60_000)}m old) — resetting`);
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Sync interrupted (server restarted) — please try again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, existingJob.id));
      }
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
    resumedFrom: job.resumedFrom ?? null,
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
 * GET /api/me/library/sync/:jobId/search-matched — full paginated list of tracks
 * that were matched by artist+title search (lower confidence) for a completed sync job.
 *
 * Query params:
 * - `format` — "json" (default) | "csv" — set Content-Disposition when csv.
 * - `page`   — 1-based page number (default 1). Ignored for csv (returns all).
 * - `limit`  — page size 1–1000 (default 200).
 *
 * Response body (json): { items: [{mbid,artist,title,spotifyUrl}], total, page, limit, pages }
 *
 * The list is sourced by joining the stored searchMatchedMbids from the receipt
 * against the recordings table — artist/title are never fabricated, they come
 * from the spine. Jobs from before this feature shipped have no searchMatchedMbids
 * and fall back to the capped searchMatchedItems preview list.
 */
router.get("/me/library/sync/:jobId/search-matched", h(async (req, res) => {
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
  const total = receipt.searchMatched;

  const formatRaw = req.query["format"];
  const format = formatRaw === "csv" ? "csv" : "json";
  const limitRaw = parseInt(typeof req.query["limit"] === "string" ? req.query["limit"] : "", 10);
  const limit = isNaN(limitRaw) ? 200 : Math.max(1, Math.min(limitRaw, 1000));
  const pageRaw = parseInt(typeof req.query["page"] === "string" ? req.query["page"] : "", 10);
  const page = isNaN(pageRaw) ? 1 : Math.max(1, pageRaw);

  interface SearchMatchedRow { mbid: string; artist: string; title: string; spotifyUrl: string }

  let allItems: SearchMatchedRow[];

  if (receipt.searchMatchedMbids && receipt.searchMatchedMbids.length > 0) {
    // New-style receipt: full MBID list stored, join recordings for details.
    const mbids = receipt.searchMatchedMbids;
    const recs = await db
      .select({ mbid: recordingsTable.mbid, artist: recordingsTable.artist, title: recordingsTable.title })
      .from(recordingsTable)
      .where(inArray(recordingsTable.mbid, mbids));
    const recMap = new Map(recs.map((r) => [r.mbid, r]));

    // Pair each MBID back with its spotifyUrl from the preview list (if present).
    const spotifyUrlMap = new Map(receipt.searchMatchedItems.map((i) => [i.mbid, i.spotifyUrl]));

    allItems = mbids.map((mbid) => {
      const rec = recMap.get(mbid);
      const artist = rec?.artist ?? "";
      const title = rec?.title ?? "";
      const spotifyUrl = spotifyUrlMap.get(mbid) ?? `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`)}`;
      return { mbid, artist, title, spotifyUrl };
    });
  } else {
    // Legacy receipt (no searchMatchedMbids): fall back to the capped preview list.
    allItems = receipt.searchMatchedItems.map((item) => ({
      mbid: item.mbid,
      artist: item.artist,
      title: item.title,
      spotifyUrl: item.spotifyUrl,
    }));
  }

  if (format === "csv") {
    const lines = [
      "mbid,artist,title,spotify_url",
      ...allItems.map((r) => [r.mbid, r.artist, r.title, r.spotifyUrl]
        .map((v) => `"${v.replace(/"/g, '""')}"`)
        .join(",")),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="sync-${jobId}-search-matched.csv"`,
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
 * On boot: find sync jobs that were interrupted mid-run.
 * - Jobs with committedOffset > 0 have real progress — resume them immediately.
 * - Jobs with no committed progress are marked as error so the user can start fresh.
 *
 * Called once at server startup so users with large libraries pick up where
 * they left off instead of losing all their matching work.
 */
export async function markOrphanedSyncJobsAsError(): Promise<void> {
  try {
    const stuck = await db
      .select()
      .from(librarySyncJobsTable)
      .where(inArray(librarySyncJobsTable.status, ["running", "pending"]));

    if (stuck.length === 0) return;

    const resumable: typeof stuck = [];
    const dead: typeof stuck = [];

    for (const job of stuck) {
      if (job.committedOffset > 0) {
        resumable.push(job);
      } else {
        dead.push(job);
      }
    }

    if (dead.length > 0) {
      await db
        .update(librarySyncJobsTable)
        .set({ status: "error", error: "Server restarted — please start a new sync", finishedAt: new Date() })
        .where(inArray(librarySyncJobsTable.id, dead.map((j) => j.id)));
      console.log(`[me] marked ${dead.length} orphaned sync job(s) as error (no committed progress)`);
    }

    // Resume jobs that have committed matching progress.
    for (const job of resumable) {
      const [conn] = await db
        .select()
        .from(serviceConnectionsTable)
        .where(
          and(
            eq(serviceConnectionsTable.userId, job.userId),
            eq(serviceConnectionsTable.service, job.service),
          ),
        )
        .limit(1);

      if (!conn) {
        // No connection available — cannot resume.
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Server restarted — Spotify connection not found, please sync again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, job.id));
        console.warn(`[me] sync job=${job.id} has progress but no service connection — marked error`);
        continue;
      }

      // Check token freshness before resuming — if the refresh token is expired
      // or revoked (user disconnected Spotify while the server was down) the job
      // would otherwise spin forever until the next poll surfaces the error.
      const freshToken = await getFreshToken(conn);
      if (!freshToken) {
        await db
          .update(librarySyncJobsTable)
          .set({ status: "error", error: "Spotify token expired or revoked — please reconnect Spotify and sync again", finishedAt: new Date() })
          .where(eq(librarySyncJobsTable.id, job.id));
        console.warn(`[me] sync job=${job.id} token refresh failed on boot — marked error`);
        continue;
      }

      console.log(`[me] resuming sync job=${job.id} from committedOffset=${job.committedOffset}`);
      setImmediate(() => runSyncWorker(job.id, job.userId, conn, job.committedOffset));
    }
  } catch (err) {
    console.error("[me] failed to handle orphaned sync jobs on boot", err);
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

/**
 * GET /api/me/crossings?date=YYYY-MM-DD — rolling 24-hour station crossing
 * scores computed server-side.
 *
 * Returns { items: { stationSlug, crossings, artistCrossings }[] } for
 * stations that have ≥ 1 crossing of either type in the past 24 hours.
 * Only non-hidden stations are included.
 *
 * Crossings   = spins whose exact MBID *or* any track from the same primary
 *               release group is in the user's library_items.
 * ArtistCrossings = spins by library artists (artistMbid or soft name-based
 *               fallback) where the exact track/album is NOT in the library.
 *
 * The `date` param is accepted for client-side cache-key alignment but the
 * server always computes a true rolling NOW() − 24 h window.
 */
router.get("/me/crossings", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Subquery: recording MBIDs in user's library.
  const userLibMbids = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(eq(libraryItemsTable.userId, user.id));

  // Subquery: release-group MBIDs represented in the user's library (album widening).
  const userLibRgs = db
    .select({ releaseGroupMbid: recordingReleaseGroupsTable.releaseGroupMbid })
    .from(recordingReleaseGroupsTable)
    .innerJoin(
      libraryItemsTable,
      eq(recordingReleaseGroupsTable.recordingMbid, libraryItemsTable.mbid),
    )
    .where(eq(libraryItemsTable.userId, user.id));

  // Subquery: artist MBIDs whose recordings are in the user's library.
  const userLibArtists = db
    .select({ artistMbid: recordingsTable.artistMbid })
    .from(recordingsTable)
    .innerJoin(libraryItemsTable, eq(recordingsTable.mbid, libraryItemsTable.mbid))
    .where(
      and(
        eq(libraryItemsTable.userId, user.id),
        isNotNull(recordingsTable.artistMbid),
      ),
    );

  // ── Composite SQL predicates ──────────────────────────────────────────────
  // Library hit: exact MBID OR any track from the same primary release group.
  const libHit = sql`(
    ${spinsTable.mbid} in (${userLibMbids})
    or (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is not null
      and ${recordingReleaseGroupsTable.releaseGroupMbid} in (${userLibRgs})
    )
  )`;

  // Explicit negation of libHit (avoids NOT IN on a nullable column; both
  // subqueries return non-null rows so NOT IN is safe here).
  const notLibHit = sql`(
    ${spinsTable.mbid} not in (${userLibMbids})
    and (
      ${recordingReleaseGroupsTable.releaseGroupMbid} is null
      or ${recordingReleaseGroupsTable.releaseGroupMbid} not in (${userLibRgs})
    )
  )`;

  // Soft-artist subquery: unresolved Spotify imports matched by lowercased
  // artist name when no artistMbid is available on the spin's recording.
  //
  // Previously this was fetched in application code and passed as a literal
  // array — e.g. = any(array['artist1','artist2',...1500 more...]).  With a
  // large unresolved import that produces ~1,500 distinct artist names the
  // serialised array literal alone took several seconds to parse and Postgres
  // could not plan it as a hash-join, driving total query time to 20 s+.
  //
  // A SQL subquery lets the planner build a hash-table of soft artist names
  // once and probe it per recording row — effectively O(n) instead of O(n·m).
  // The try/catch around the old fetch is no longer needed: if the table is
  // absent the subquery returns zero rows and the query degrades cleanly.
  const userSoftArtists = db
    .selectDistinct({ artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
    .from(spotifyLibraryItemsTable)
    .where(
      and(
        eq(spotifyLibraryItemsTable.userId, user.id),
        isNull(spotifyLibraryItemsTable.mbid),
        ne(spotifyLibraryItemsTable.artist, ""),
      ),
    );

  // Artist match: MBID-based lookup + soft name subquery fallback.
  const artistMatch = sql`(
    ${recordingsTable.artistMbid} in (${userLibArtists})
    or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
  )`;

  const rows = await db
    .select({
      stationSlug: stationsTable.slug,
      crossings:       sql<number>`count(*) filter (where ${libHit})::int`,
      artistCrossings: sql<number>`count(*) filter (where ${notLibHit} and ${artistMatch})::int`,
    })
    .from(spinsTable)
    .innerJoin(stationsTable, eq(spinsTable.stationId, stationsTable.id))
    .innerJoin(recordingsTable, eq(recordingsTable.mbid, spinsTable.mbid!))
    .leftJoin(
      recordingReleaseGroupsTable,
      and(
        eq(recordingReleaseGroupsTable.recordingMbid, recordingsTable.mbid),
        eq(recordingReleaseGroupsTable.isPrimary, true),
      ),
    )
    .where(
      and(
        isNotNull(spinsTable.mbid),
        gte(spinsTable.playedAt, cutoff),
        eq(stationsTable.hidden, false),
      ),
    )
    .groupBy(stationsTable.id, stationsTable.slug)
    .having(
      sql`count(*) filter (where ${libHit}) > 0
       or count(*) filter (where ${notLibHit} and ${artistMatch}) > 0`,
    );

  return res.json({
    items: rows.map((r) => ({
      stationSlug: r.stationSlug,
      crossings: r.crossings,
      artistCrossings: r.artistCrossings,
    })),
  });
}));

export default router;
