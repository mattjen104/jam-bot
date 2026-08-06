import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { SpotifyPlayBody, SpotifyQueueRunBody } from "@workspace/api-zod";
import { db, recordingsTable, loreUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  spotifyConnectConfigured,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  createConnection,
  backfillConnectionProfile,
  deleteConnection,
  getFreshConnection,
  getRawConnectionRow,
  resolveSpotifyTrack,
  playTrack,
  playTracks,
  pausePlayback,
  resumePlayback,
  getPlayerState,
  listDevices,
  SpotifyPlayError,
  saveTrackToLibrary,
  isTrackSaved,
  trackIdFromUri,
  SpotifyLibraryError,
  fetchRecentlyPlayed,
} from "../../lore/spotifyConnect.js";
import {
  getUserFromSession,
  getOrCreateAnonymousUser,
  recoverUserByServiceId,
  SID_COOKIE,
  SID_MAX_AGE_MS,
  cookieSidOpts,
} from "../../lore/userSession.js";
import { getTrackById, getAlbumTracks } from "../../spotify/appClient.js";

/**
 * Spotify Connect routes. The listener's identity is an opaque httpOnly
 * cookie (`lore_sid`); tokens live server-side. Audio never touches Lore —
 * these endpoints only command the listener's own Spotify app.
 *
 * /login and /callback are browser-navigation redirects (not in the OpenAPI
 * spec); the JSON endpoints (status/play/pause/resume/player/logout) are.
 */

// SID_COOKIE and SID_MAX_AGE_MS are imported from userSession (2-year lifetime).
const STATE_COOKIE = "lore_spotify_state";
/** Where to send the browser after the OAuth dance (the Lore app). */
const APP_RETURN_PATH = process.env.LORE_APP_URL ?? "/lore/";

const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 minutes

/**
 * Separate playback-only cookie.  Stores the `spotify_connections.sid` that
 * playback endpoints need to look up Spotify tokens.  Intentionally distinct
 * from `lore_sid` (Lore device identity) so that disconnecting Spotify
 * playback never rotates or clears the user's durable Lore identity.
 */
const PLAYBACK_SID_COOKIE = "spotify_playback_sid";
const PLAYBACK_SID_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

const router: IRouter = Router();

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/**
 * Returns the Spotify Connect session id used to look up playback tokens.
 * Reads the dedicated `spotify_playback_sid` cookie first; falls back to
 * `lore_sid` for sessions established before the cookie split.
 */
function sidFrom(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const playbackSid = cookies?.[PLAYBACK_SID_COOKIE];
  if (typeof playbackSid === "string" && playbackSid.length > 0) return playbackSid;
  // Backward compat: old sessions stored the spotify_connections.sid in lore_sid.
  const loreSid = cookies?.[SID_COOKIE];
  return typeof loreSid === "string" && loreSid.length > 0 ? loreSid : null;
}

function notConfigured(res: Response): void {
  res.status(503).json({
    error:
      "Spotify is not configured on this server (missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)",
  });
}

// --- OAuth dance (browser navigation, not JSON API) ------------------------

router.get("/spotify/login", (_req: Request, res: Response) => {
  if (!spotifyConnectConfigured()) {
    notConfigured(res);
    return;
  }
  const state = randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, cookieOpts(STATE_MAX_AGE_MS));
  res.redirect(buildAuthorizeUrl(state));
});

router.get("/spotify/callback", async (req: Request, res: Response) => {
  if (!spotifyConnectConfigured()) {
    notConfigured(res);
    return;
  }
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const expectedState = (
    req as Request & { cookies?: Record<string, string> }
  ).cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: "/" });

  if (error) {
    // Listener declined on Spotify's consent screen — back to the app, honestly.
    res.redirect(`${APP_RETURN_PATH}?spotify=denied`);
    return;
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    res.redirect(`${APP_RETURN_PATH}?spotify=error`);
    return;
  }

  try {
    const tokens = await exchangeCode(code);
    const profile = await fetchProfile(tokens.access_token);

    // Clean up any prior playback connection for this browser session.
    // sidFrom() reads the dedicated playback cookie (falls back to lore_sid for
    // old sessions), so this only removes the Spotify token row — it never
    // touches the durable Lore identity.
    const oldPlaybackSid = sidFrom(req);
    if (oldPlaybackSid) await deleteConnection(oldPlaybackSid).catch(() => {});

    // Create the new Spotify Connect (playback) token record.
    const sid = await createConnection(tokens, profile);

    // Set the playback-only cookie.  This intentionally does NOT overwrite
    // lore_sid — playback state is separate from durable Lore identity.
    res.cookie(PLAYBACK_SID_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: PLAYBACK_SID_MAX_AGE_MS,
    });

    // Resolve the Lore device identity independently of the playback session.
    // Prefer an existing lore_sid; provision a fresh anonymous device key only
    // when the browser has no identity yet (true first-time visitor).
    const existingLoreSid = (req as Request & { cookies?: Record<string, string> })
      .cookies?.[SID_COOKIE];
    const loreDeviceKey =
      typeof existingLoreSid === "string" && existingLoreSid.length > 0
        ? existingLoreSid
        : randomUUID();
    const user = await getOrCreateAnonymousUser(loreDeviceKey);
    res.cookie(SID_COOKIE, loreDeviceKey, cookieSidOpts());

    // Attempt library recovery: if this Spotify account is already anchored to
    // a prior Lore identity (via service_connections.externalUserId), merge.
    if (profile.spotifyUserId) {
      const { user: recovered, recovered: didRecover } =
        await recoverUserByServiceId("spotify", profile.spotifyUserId, user.id);
      if (didRecover) {
        // Update the recovered user's deviceKey to the preserved lore_sid so
        // the identity cookie continues to resolve the right user.
        await db
          .update(loreUsersTable)
          .set({ deviceKey: loreDeviceKey, spotifyConnectionId: sid })
          .where(eq(loreUsersTable.id, recovered.id))
          .catch((err: unknown) =>
            console.error("[spotify] recovered user deviceKey update failed", err),
          );
      } else {
        // No recovery — keep spotifyConnectionId pointing at the new playback row.
        await db
          .update(loreUsersTable)
          .set({ spotifyConnectionId: sid })
          .where(eq(loreUsersTable.id, user.id))
          .catch(() => {});
      }
    }

    res.redirect(`${APP_RETURN_PATH}?spotify=connected`);
  } catch (err) {
    console.error("[spotify] OAuth callback failed", err);
    res.redirect(`${APP_RETURN_PATH}?spotify=error`);
  }
});

// --- JSON API ---------------------------------------------------------------

router.get("/spotify/status", async (req: Request, res: Response) => {
  const configured = spotifyConnectConfigured();
  const sid = configured ? sidFrom(req) : null;
  const conn = sid ? await getFreshConnection(sid) : null;

  // If getFreshConnection returned null we need to distinguish:
  //  (a) no row exists → user genuinely disconnected → connected: false
  //  (b) row exists but token refresh failed transiently → keep connected: true
  //      so the client doesn't clear the pinned device on a momentary Spotify blip.
  const rawRow = !conn && sid ? await getRawConnectionRow(sid) : null;
  const effectiveConn = conn ?? rawRow;

  // Self-heal: if the product tier was never captured at connect time (the
  // profile fetch can fail silently), re-fetch and persist it so the client
  // learns the real tier instead of hiding Premium features forever.
  // Only attempt this when we have a freshly-refreshed token (not a stale row).
  let displayName = effectiveConn?.displayName ?? null;
  let product = effectiveConn?.product ?? null;
  if (conn && !product) {
    const profile = await backfillConnectionProfile(conn);
    if (profile) {
      displayName = profile.displayName ?? displayName;
      product = profile.product;
    }
  }
  res.json({
    configured,
    connected: !!effectiveConn,
    displayName,
    product,
  });
});

router.post("/spotify/logout", async (req: Request, res: Response) => {
  const sid = sidFrom(req);
  if (sid) await deleteConnection(sid).catch(() => {});
  // Clear ONLY the playback cookie — never lore_sid.  lore_sid is the durable
  // Lore identity; clearing it would strand the user's library on next visit.
  res.clearCookie(PLAYBACK_SID_COOKIE, { path: "/" });
  res.status(204).end();
});

/** Loads a fresh connection or answers 401/503; returns null when handled. */
async function requireConnection(req: Request, res: Response) {
  if (!spotifyConnectConfigured()) {
    notConfigured(res);
    return null;
  }
  const sid = sidFrom(req);
  const conn = sid ? await getFreshConnection(sid) : null;
  if (!conn) {
    res.status(401).json({ error: "Spotify is not connected for this session" });
    return null;
  }
  return conn;
}

/**
 * POST /spotify/queue-run
 *
 * Queue an entire past-crossing run on the listener's Spotify Connect device
 * in a single gapless call.  Accepts a list of spotify:track:<id> URIs already
 * known client-side (from recording links), so no MBID resolution is needed.
 *
 * This is the Tier-1 playback path: one uris-array call for the whole run,
 * never per-track commands.  Requires Premium and an active Connect device.
 */
router.post("/spotify/queue-run", async (req: Request, res: Response) => {
  const parsed = SpotifyQueueRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "uris (non-empty array of Spotify track URIs) is required" });
    return;
  }
  const conn = await requireConnection(req, res);
  if (!conn) return;

  if (conn.product && conn.product !== "premium") {
    res.status(403).json({ error: "Spotify Premium is required for remote playback" });
    return;
  }

  try {
    await playTracks(conn.accessToken, parsed.data.uris, parsed.data.deviceId ?? null);
    res.json({ queued: parsed.data.uris.length });
  } catch (err) {
    if (err instanceof SpotifyPlayError) {
      const status =
        err.code === "premium_required" ? 403
        : err.code === "no_active_device" ? 409
        : err.code === "rate_limited" ? 429
        : 502;
      const body: Record<string, unknown> = { error: err.message };
      if (err.code === "rate_limited") body.retryAfter = err.retryAfterSecs ?? 30;
      res.status(status).json(body);
      return;
    }
    throw err;
  }
});

router.post("/spotify/play", async (req: Request, res: Response) => {
  const parsed = SpotifyPlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "mbid is required" });
    return;
  }
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const rows = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, parsed.data.mbid))
    .limit(1);
  const recording = rows[0];
  if (!recording) {
    res.status(404).json({ error: "Recording not on the spine" });
    return;
  }

  if (conn.product && conn.product !== "premium") {
    res.status(403).json({
      error: "Spotify Premium is required for remote playback",
    });
    return;
  }

  try {
    const track = await resolveSpotifyTrack(recording, conn.accessToken);
    if (!track) {
      res
        .status(404)
        .json({ error: "This recording could not be found on Spotify" });
      return;
    }
    const outcome = await playTrack(
      conn.accessToken,
      track.uri,
      parsed.data.deviceId ?? null,
    );
    res.json({
      trackUri: track.uri,
      trackUrl: track.url,
      matchSource: track.source,
      deviceName: outcome.deviceName,
      durationMs: track.durationMs,
    });
  } catch (err) {
    if (err instanceof SpotifyPlayError) {
      const status =
        err.code === "premium_required"
          ? 403
          : err.code === "no_active_device"
            ? 409
            : err.code === "rate_limited"
              ? 429
              : 502;
      const body: Record<string, unknown> = { error: err.message };
      if (err.code === "rate_limited") body.retryAfter = err.retryAfterSecs ?? 30;
      res.status(status).json(body);
      return;
    }
    throw err;
  }
});

router.post("/spotify/pause", async (req: Request, res: Response) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  await pausePlayback(conn.accessToken);
  res.status(204).end();
});

router.post("/spotify/resume", async (req: Request, res: Response) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  try {
    await resumePlayback(conn.accessToken);
    res.status(204).end();
  } catch (err) {
    if (err instanceof SpotifyPlayError && err.code === "no_active_device") {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Resolve an mbid (from body or query) to a Spotify track id, or answer 404. */
async function resolveTrackIdOr404(
  mbid: string,
  res: Response,
  userAccessToken?: string,
): Promise<string | null> {
  const rows = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.mbid, mbid))
    .limit(1);
  const recording = rows[0];
  if (!recording) {
    res.status(404).json({ error: "Recording not on the spine" });
    return null;
  }
  let track;
  try {
    track = await resolveSpotifyTrack(recording, userAccessToken);
  } catch (err) {
    if (err instanceof SpotifyPlayError) {
      res.status(502).json({ error: err.message });
      return null;
    }
    throw err;
  }
  const trackId = track ? trackIdFromUri(track.uri) : null;
  if (!trackId) {
    res.status(404).json({ error: "This recording could not be found on Spotify" });
    return null;
  }
  return trackId;
}

function handleLibraryError(err: unknown, res: Response): void {
  if (err instanceof SpotifyLibraryError) {
    const status = err.code === "insufficient_scope" ? 403 : 502;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  throw err;
}

router.post("/spotify/save", async (req: Request, res: Response) => {
  const parsed = SpotifyPlayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "mbid is required" });
    return;
  }
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const trackId = await resolveTrackIdOr404(parsed.data.mbid, res, conn.accessToken);
  if (!trackId) return;
  try {
    await saveTrackToLibrary(conn.accessToken, trackId);
    res.json({ saved: true });
  } catch (err) {
    handleLibraryError(err, res);
  }
});

router.get("/spotify/saved", async (req: Request, res: Response) => {
  const mbid = typeof req.query.mbid === "string" ? req.query.mbid : "";
  if (!mbid) {
    res.status(400).json({ error: "mbid is required" });
    return;
  }
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const trackId = await resolveTrackIdOr404(mbid, res, conn.accessToken);
  if (!trackId) return;
  try {
    const saved = await isTrackSaved(conn.accessToken, trackId);
    res.json({ saved });
  } catch (err) {
    handleLibraryError(err, res);
  }
});

router.get("/spotify/player", async (req: Request, res: Response) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const state = await getPlayerState(conn.accessToken);
  res.json(state);
});

/**
 * GET /spotify/recently-played
 *
 * Proxy for Spotify's /v1/me/player/recently-played. Returns up to 50 tracks,
 * optionally filtered to tracks played after `after` (Unix ms timestamp).
 *
 * Responds 204 (empty body) when the token predates the
 * `user-read-recently-played` scope so callers can silently no-op.
 */
router.get("/spotify/recently-played", async (req: Request, res: Response) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;

  const afterParam =
    typeof req.query.after === "string" ? Number(req.query.after) : undefined;
  const after =
    afterParam !== undefined && Number.isFinite(afterParam)
      ? afterParam
      : undefined;

  const tracks = await fetchRecentlyPlayed(conn.accessToken, after);
  if (tracks === null) {
    res.status(204).end();
    return;
  }
  res.json({ tracks });
});

router.get("/spotify/devices", async (req: Request, res: Response) => {
  const conn = await requireConnection(req, res);
  if (!conn) return;
  const devices = await listDevices(conn.accessToken);
  res.json({ devices });
});

/**
 * Fetch the full ordered track list for the album a given track belongs to.
 * Uses app-level client credentials — no user OAuth needed.
 * GET /api/spotify/album-tracks?trackId=<spotify-track-id>
 */
router.get("/spotify/album-tracks", async (req: Request, res: Response) => {
  const trackId = typeof req.query.trackId === "string" ? req.query.trackId.trim() : "";
  if (!trackId) {
    res.status(400).json({ error: "trackId query param is required" });
    return;
  }
  const track = await getTrackById(trackId);
  if (!track?.albumId) {
    res.json({ tracks: [] });
    return;
  }
  const tracks = await getAlbumTracks(track.albumId);
  res.json({ tracks });
});

export default router;
