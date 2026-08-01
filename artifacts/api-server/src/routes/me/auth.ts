import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db,
  serviceConnectionsTable,
  keepTargetsTable,
  type LoreUser,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  getUserFromSession,
  getOrCreateAnonymousUser,
  recoverUserByServiceId,
  SID_COOKIE,
  cookieSidOpts,
} from "../../lore/userSession.js";
import { fetchProfile } from "../../lore/spotifyConnect.js";
import {
  getConnector,
  refreshServiceToken,
} from "../../lore/serviceConnector.js";
import { encryptToken, decryptToken } from "../../lore/tokenCrypto.js";
import { h } from "../../middlewares/asyncHandler.js";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_COOKIE = "lore_me_spotify_state";
const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 min
/** Base URL to redirect to after OAuth. */
const APP_RETURN_PATH = process.env.LORE_APP_URL ?? "/lore/";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Extend Request with the resolved user attached by requireUser. */
export interface AuthedRequest extends Request {
  loreUser: LoreUser;
}

// ---------------------------------------------------------------------------
// Shared helpers (exported for sub-routers)
// ---------------------------------------------------------------------------

export function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

export function meCallbackUri(): string {
  const explicit = process.env.SPOTIFY_LIBRARY_REDIRECT_URI;
  if (explicit) return explicit;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) throw new Error("Cannot derive redirect URI: set SPOTIFY_LIBRARY_REDIRECT_URI");
  return `https://${domain}/api/me/connect/spotify/callback`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Load a fresh access token for a service_connections row, refreshing if needed.
 *  Handles encrypt/decrypt transparently — callers receive a plaintext token. */
export async function getFreshToken(
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
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * Middleware: resolves (or silently provisions) the `lore_users` row from the
 * `lore_sid` cookie and attaches it as `req.loreUser`.
 *
 * If no valid `lore_sid` cookie is present, a fresh anonymous user is created
 * and the cookie is set in the response before any handler runs. This means
 * every `/me/*` request auto-provisions a device identity — no login wall.
 */
export async function requireUserMiddleware(
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

export default router;

// ---------------------------------------------------------------------------
// Connection endpoints (require auth — mounted AFTER requireUserMiddleware in
// index.ts via the named `connectionsRouter` export).
// ---------------------------------------------------------------------------

const connectionsRouter: IRouter = Router();

/**
 * GET /api/me/connections — list service connections + capabilities.
 * Shape mirrors what the frontend "Connect" panel needs.
 */
connectionsRouter.get("/me/connections", h(async (req, res) => {
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

export { connectionsRouter };
