import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { SpotifyPlayBody } from "@workspace/api-zod";
import { db, recordingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  spotifyConnectConfigured,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  createConnection,
  deleteConnection,
  getFreshConnection,
  resolveSpotifyTrack,
  playTrack,
  pausePlayback,
  resumePlayback,
  getPlayerState,
  SpotifyPlayError,
  saveTrackToLibrary,
  isTrackSaved,
  trackIdFromUri,
  SpotifyLibraryError,
} from "../../lore/spotifyConnect.js";
import { upsertLoreUserForSid } from "../../lore/userSession.js";

/**
 * Spotify Connect routes. The listener's identity is an opaque httpOnly
 * cookie (`lore_sid`); tokens live server-side. Audio never touches Lore —
 * these endpoints only command the listener's own Spotify app.
 *
 * /login and /callback are browser-navigation redirects (not in the OpenAPI
 * spec); the JSON endpoints (status/play/pause/resume/player/logout) are.
 */

const SID_COOKIE = "lore_sid";
const STATE_COOKIE = "lore_spotify_state";
/** Where to send the browser after the OAuth dance (the Lore app). */
const APP_RETURN_PATH = process.env.LORE_APP_URL ?? "/lore/";

const SID_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
const STATE_MAX_AGE_MS = 1000 * 60 * 10; // 10 minutes

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

function sidFrom(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const sid = cookies?.[SID_COOKIE];
  return typeof sid === "string" && sid.length > 0 ? sid : null;
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
    // A prior connection for this browser is superseded, not leaked.
    const oldSid = sidFrom(req);
    if (oldSid) await deleteConnection(oldSid).catch(() => {});
    const sid = await createConnection(tokens, profile);
    res.cookie(SID_COOKIE, sid, cookieOpts(SID_MAX_AGE_MS));
    // Bootstrap persistent user identity keyed by Spotify user id.
    if (profile.spotifyUserId) {
      await upsertLoreUserForSid(profile.spotifyUserId, sid).catch((err) => {
        console.error("[spotify] lore_users upsert failed", err);
      });
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
  res.json({
    configured,
    connected: !!conn,
    displayName: conn?.displayName ?? null,
    product: conn?.product ?? null,
  });
});

router.post("/spotify/logout", async (req: Request, res: Response) => {
  const sid = sidFrom(req);
  if (sid) await deleteConnection(sid).catch(() => {});
  res.clearCookie(SID_COOKIE, { path: "/" });
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

  const track = await resolveSpotifyTrack(recording);
  if (!track) {
    res.status(404).json({ error: "This recording could not be found on Spotify" });
    return;
  }

  if (conn.product && conn.product !== "premium") {
    res.status(403).json({
      error: "Spotify Premium is required for remote playback",
    });
    return;
  }

  try {
    const outcome = await playTrack(conn.accessToken, track.uri);
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
            : 502;
      res.status(status).json({ error: err.message });
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
  const track = await resolveSpotifyTrack(recording);
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
  const trackId = await resolveTrackIdOr404(parsed.data.mbid, res);
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
  const trackId = await resolveTrackIdOr404(mbid, res);
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

export default router;
