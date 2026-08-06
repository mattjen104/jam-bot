import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  db,
  spotifyConnectionsTable,
  type SpotifyConnection,
  type Recording,
  type RecordingLink,
} from "@workspace/db";
import { searchTrack } from "../spotify/appClient.js";

/**
 * Spotify Connect for Lore rides: remote-control the LISTENER'S OWN Spotify
 * app via the Web API player endpoints. No SDK, no audio proxying — Spotify
 * plays on the listener's device; Lore only sends commands and reads state.
 *
 * Identity: Lore has no accounts. A random opaque sid in an httpOnly cookie
 * maps to OAuth tokens in `spotify_connections`. Delete row = disconnect.
 *
 * Honest degradation: when the server has no app credentials everything here
 * reports "not configured" (503 at the route layer) — never a silent no-op.
 */

const ACCOUNTS_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";

/** Scopes: read player state (auto-advance), control playback, read product
 * tier, read/save Liked Songs (the heart button), and read recent history for
 * journal sync. */
export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-private",
  "user-library-read",
  "user-library-modify",
  "user-read-recently-played",
].join(" ");

export function spotifyConnectConfigured(): boolean {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/**
 * The externally reachable OAuth callback. The platform proxy exposes the API
 * server at the domain root under /api/..., so that is the path Spotify must
 * redirect back to (verified: /api/healthz answers externally).
 */
export function spotifyRedirectUri(): string {
  const explicit = process.env.SPOTIFY_REDIRECT_URI;
  if (explicit) return explicit;
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (!domain) {
    throw new Error(
      "Cannot derive Spotify redirect URI: set SPOTIFY_REDIRECT_URI",
    );
  }
  return `https://${domain}/api/spotify/callback`;
}

export function newOpaqueId(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    scope: SPOTIFY_SCOPES,
    state,
  });
  return `${ACCOUNTS_BASE}/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function basicAuthHeader(): string {
  const id = process.env.SPOTIFY_CLIENT_ID ?? "";
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify token request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: spotifyRedirectUri(),
    }),
  );
}

async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

// ---------------------------------------------------------------------------
// Connections (sid -> tokens)
// ---------------------------------------------------------------------------

export interface SpotifyProfile {
  spotifyUserId: string | null;
  displayName: string | null;
  product: string | null;
}

export async function fetchProfile(accessToken: string): Promise<SpotifyProfile> {
  const res = await fetch(`${API_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { spotifyUserId: null, displayName: null, product: null };
  const body = (await res.json()) as {
    id?: string;
    display_name?: string;
    product?: string;
  };
  return {
    spotifyUserId: body.id ?? null,
    displayName: body.display_name ?? null,
    product: body.product ?? null,
  };
}

function expiryDate(expiresInSeconds: number): Date {
  // Refresh a minute early to avoid edge-of-expiry failures.
  return new Date(Date.now() + Math.max(0, expiresInSeconds - 60) * 1000);
}

/** Create a connection row for freshly exchanged tokens; returns the new sid. */
export async function createConnection(
  tokens: TokenResponse,
  profile: SpotifyProfile,
): Promise<string> {
  if (!tokens.refresh_token) {
    throw new Error("Spotify token exchange returned no refresh_token");
  }
  const sid = newOpaqueId();
  await db.insert(spotifyConnectionsTable).values({
    sid,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: expiryDate(tokens.expires_in),
    displayName: profile.displayName,
    product: profile.product,
    spotifyUserId: profile.spotifyUserId,
  });
  return sid;
}

/**
 * Backfill a connection's profile fields (product tier, display name, user id)
 * when they were never captured — e.g. the profile fetch failed at connect
 * time. Best-effort: on failure the row is left unchanged and null is
 * returned so callers keep serving the stored (blank) values honestly.
 */
export async function backfillConnectionProfile(
  conn: SpotifyConnection,
): Promise<SpotifyProfile | null> {
  try {
    const profile = await fetchProfile(conn.accessToken);
    // A null product means the fetch failed or the token can't see the tier;
    // don't write anything so a later attempt can still succeed.
    if (!profile.product) return null;
    await db
      .update(spotifyConnectionsTable)
      .set({
        product: profile.product,
        displayName: profile.displayName ?? conn.displayName,
        spotifyUserId: profile.spotifyUserId ?? conn.spotifyUserId,
        updatedAt: new Date(),
      })
      .where(eq(spotifyConnectionsTable.sid, conn.sid));
    return profile;
  } catch (err) {
    console.error("[spotify] profile backfill failed", err);
    return null;
  }
}

export async function deleteConnection(sid: string): Promise<void> {
  await db
    .delete(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, sid));
}

/**
 * Read the raw connection row without attempting a token refresh. Returns null
 * only when no row exists for this sid. Used by the status endpoint so a
 * transient Spotify refresh failure doesn't make the user look "disconnected".
 */
export async function getRawConnectionRow(
  sid: string,
): Promise<SpotifyConnection | null> {
  const rows = await db
    .select()
    .from(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, sid))
    .limit(1);
  return rows[0] ?? null;
}

export async function getFreshConnection(
  sid: string,
): Promise<SpotifyConnection | null> {
  const rows = await db
    .select()
    .from(spotifyConnectionsTable)
    .where(eq(spotifyConnectionsTable.sid, sid))
    .limit(1);
  const conn = rows[0];
  if (!conn) return null;
  if (conn.expiresAt.getTime() > Date.now()) return conn;

  try {
    const refreshed = await refreshTokens(conn.refreshToken);
    const updated = {
      accessToken: refreshed.access_token,
      // Spotify usually omits refresh_token on refresh; keep the old one.
      refreshToken: refreshed.refresh_token ?? conn.refreshToken,
      expiresAt: expiryDate(refreshed.expires_in),
      updatedAt: new Date(),
    };
    await db
      .update(spotifyConnectionsTable)
      .set(updated)
      .where(eq(spotifyConnectionsTable.sid, sid));
    return { ...conn, ...updated };
  } catch (err) {
    // A 400 "invalid_grant" is permanent (token revoked by the user or
    // expired beyond Spotify's rolling window) — nuke the row so the UI
    // surfaces a proper "reconnect" prompt instead of silently failing.
    // Any other error (network timeout, Spotify 5xx, DNS) is transient —
    // keep the row so the user isn't logged out by a momentary blip.
    const msg = err instanceof Error ? err.message : String(err);
    const isPermanent = msg.includes("(400)") && msg.includes("invalid_grant");
    if (isPermanent) {
      console.error(`[spotify] refresh token permanently revoked — disconnecting sid`, err);
      await deleteConnection(sid).catch(() => {});
    } else {
      console.warn(`[spotify] token refresh failed (transient) — keeping connection for next attempt`, err);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// MBID -> Spotify track resolution ladder (exact link > ISRC > text search)
// ---------------------------------------------------------------------------

export type SpotifyMatchSource = "link" | "isrc" | "search";

export interface ResolvedSpotifyTrack {
  uri: string;
  url: string | null;
  durationMs: number | null;
  source: SpotifyMatchSource;
}

/**
 * Pull an exact Spotify track id out of a recording's stored deep links
 * (Odesli-resolved). Only `kind: "exact"` links count — search links are
 * artist+title guesses and must not be treated as identity. Pure; unit-tested.
 */
export function extractSpotifyTrackId(
  links: RecordingLink[] | null | undefined,
): string | null {
  for (const link of links ?? []) {
    if (link.kind !== "exact") continue;
    const m = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(link.url);
    if (m) return m[1];
  }
  return null;
}

/** Successful resolutions only; misses always retry the full ladder. */
const resolveCache = new Map<string, ResolvedSpotifyTrack>();

interface UserSearchHit {
  uri: string;
  spotifyUrl: string;
  durationMs: number;
}

/**
 * Search Spotify's catalogue with the LISTENER'S OWN token. The app-level
 * client-credentials client shares one rate-limit bucket with every
 * background enrichment job, so play-time resolution must not depend on it —
 * a 429 there would break casting for reasons unrelated to the listener.
 */
async function searchTrackAsUser(
  accessToken: string,
  q: string,
): Promise<UserSearchHit | null> {
  const res = await fetch(
    `${API_BASE}/search?type=track&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    // Any upstream failure is an error, never a "track not found" — only a
    // 200 with empty items means a true miss.
    throw new SpotifyPlayError(
      "spotify_error",
      res.status === 429
        ? "Spotify is rate-limiting search right now — try again in a minute"
        : `Spotify search failed (${res.status})`,
    );
  }
  const parsed = (await res.json().catch(() => null)) as {
    tracks?: {
      items?: {
        uri?: string;
        duration_ms?: number;
        external_urls?: { spotify?: string };
        id?: string;
      }[];
    };
  } | null;
  const item = parsed?.tracks?.items?.[0];
  if (!item?.uri) return null;
  return {
    uri: item.uri,
    spotifyUrl:
      item.external_urls?.spotify ??
      (item.id ? `https://open.spotify.com/track/${item.id}` : item.uri),
    durationMs: item.duration_ms ?? 0,
  };
}

export async function resolveSpotifyTrack(
  recording: Pick<Recording, "mbid" | "title" | "artist" | "isrc" | "links">,
  /** When present, catalogue search uses the listener's token (separate
   * rate-limit bucket from the shared app client). */
  userAccessToken?: string | null,
): Promise<ResolvedSpotifyTrack | null> {
  const cached = resolveCache.get(recording.mbid);
  if (cached) return cached;

  let resolved: ResolvedSpotifyTrack | null = null;

  const linkedId = extractSpotifyTrackId(recording.links);
  if (linkedId) {
    resolved = {
      uri: `spotify:track:${linkedId}`,
      url: `https://open.spotify.com/track/${linkedId}`,
      durationMs: null,
      source: "link",
    };
  }

  const doSearch = async (
    q: string,
  ): Promise<{ uri: string; spotifyUrl: string; durationMs: number } | null> => {
    if (userAccessToken) return searchTrackAsUser(userAccessToken, q);
    try {
      return await searchTrack(q);
    } catch (err) {
      // The shared app client is rate-limited or down — honest, mappable error
      // instead of an opaque 500.
      throw new SpotifyPlayError(
        "spotify_error",
        `Spotify search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  if (!resolved && recording.isrc) {
    const hit = await doSearch(`isrc:${recording.isrc}`);
    if (hit) {
      resolved = {
        uri: hit.uri,
        url: hit.spotifyUrl,
        durationMs: hit.durationMs || null,
        source: "isrc",
      };
    }
  }

  if (!resolved) {
    const hit = await doSearch(
      `track:"${recording.title}" artist:"${recording.artist}"`,
    );
    if (hit) {
      resolved = {
        uri: hit.uri,
        url: hit.spotifyUrl,
        durationMs: hit.durationMs || null,
        source: "search",
      };
    }
  }

  // Search results under a user token can be market-scoped; only cache
  // token-independent resolutions (exact links, or shared app-client search)
  // so one listener's market never contaminates another's.
  if (resolved && (resolved.source === "link" || !userAccessToken)) {
    resolveCache.set(recording.mbid, resolved);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Player commands (listener's own device)
// ---------------------------------------------------------------------------

/** Route-mappable playback failure with an honest machine-readable code. */
export class SpotifyPlayError extends Error {
  constructor(
    readonly code: "premium_required" | "no_active_device" | "rate_limited" | "spotify_error",
    message: string,
    /** Present only when code === "rate_limited". */
    readonly retryAfterSecs?: number,
  ) {
    super(message);
    this.name = "SpotifyPlayError";
  }
}

interface PlayerRequestResult {
  status: number;
  body: string;
  /** Seconds to wait before retrying, from Spotify's Retry-After header (absent for non-player requests). */
  retryAfterSecs?: number | null;
}

/** Spotify Player API calls must not hang the server — cap at 10 s. */
const PLAYER_REQUEST_TIMEOUT_MS = 10_000;

async function playerRequest(
  accessToken: string,
  method: "GET" | "PUT",
  path: string,
  jsonBody?: unknown,
): Promise<PlayerRequestResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    const retryAfterRaw = res.headers.get("Retry-After");
    const retryAfterSecs =
      retryAfterRaw != null
        ? Math.max(1, parseInt(retryAfterRaw, 10) || 30)
        : null;
    return { status: res.status, body, retryAfterSecs };
  } finally {
    clearTimeout(timer);
  }
}

function throwPlayError(result: PlayerRequestResult, context: string): never {
  const lower = result.body.toLowerCase();
  if (result.status === 403 && lower.includes("premium")) {
    throw new SpotifyPlayError(
      "premium_required",
      "Spotify Premium is required for remote playback",
    );
  }
  if (result.status === 404 && lower.includes("no_active_device")) {
    throw new SpotifyPlayError(
      "no_active_device",
      "No active Spotify device — open Spotify on any device and try again",
    );
  }
  if (result.status === 429) {
    throw new SpotifyPlayError(
      "rate_limited",
      "Spotify is rate-limiting playback right now",
      result.retryAfterSecs ?? 30,
    );
  }
  throw new SpotifyPlayError(
    "spotify_error",
    `Spotify ${context} failed (${result.status}): ${result.body.slice(0, 200)}`,
  );
}

interface RawSpotifyDevice {
  id: string | null;
  name: string;
  type?: string;
  is_active: boolean;
  is_restricted: boolean;
}

export interface SpotifyConnectDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export async function listDevices(accessToken: string): Promise<SpotifyConnectDevice[]> {
  const result = await playerRequest(accessToken, "GET", "/me/player/devices");
  if (result.status !== 200) return [];
  try {
    const parsed = JSON.parse(result.body) as { devices?: RawSpotifyDevice[] };
    return (parsed.devices ?? [])
      .filter((d) => d.id && !d.is_restricted)
      .map((d) => ({
        id: d.id as string,
        name: d.name,
        type: d.type ?? "Unknown",
        isActive: d.is_active,
      }));
  } catch {
    return [];
  }
}

export interface PlayOutcome {
  deviceName: string | null;
}

/**
 * Start full-track playback of `uri` on the listener's Spotify. If `deviceId`
 * is provided (from the device picker), the play command targets that device
 * directly. If no device is active but one is available (e.g. the app is open
 * but paused-idle), we target it explicitly rather than failing.
 */
export async function playTrack(
  accessToken: string,
  uri: string,
  deviceId?: string | null,
): Promise<PlayOutcome> {
  const path = deviceId
    ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : "/me/player/play";

  const first = await playerRequest(accessToken, "PUT", path, {
    uris: [uri],
  });
  if (first.status === 202 || first.status === 204 || first.status === 200) {
    return { deviceName: null };
  }

  // If a device was explicitly pinned, don't try to auto-pick — the specific
  // device failed (offline, no longer visible), so surface that honestly.
  if (deviceId) {
    throwPlayError(first, "play");
  }

  const isNoDevice =
    first.status === 404 && first.body.toLowerCase().includes("no_active_device");
  if (isNoDevice) {
    const devices = await listDevices(accessToken);
    const target = devices.find((d) => d.isActive) ?? devices[0];
    if (target?.id) {
      const retry = await playerRequest(
        accessToken,
        "PUT",
        `/me/player/play?device_id=${encodeURIComponent(target.id)}`,
        { uris: [uri] },
      );
      if (retry.status === 202 || retry.status === 204 || retry.status === 200) {
        return { deviceName: target.name };
      }
      throwPlayError(retry, "play");
    }
  }
  throwPlayError(first, "play");
}

/**
 * Queue an ordered list of Spotify track URIs as a single gapless playlist on
 * the listener's active Connect device. Used for Tier-1 past-crossing runs —
 * the entire run is front-loaded in one call instead of per-track commands.
 */
export async function playTracks(
  accessToken: string,
  uris: string[],
  deviceId?: string | null,
): Promise<void> {
  const path = deviceId
    ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
    : "/me/player/play";
  const result = await playerRequest(accessToken, "PUT", path, { uris });
  if (result.status === 202 || result.status === 204 || result.status === 200) return;
  throwPlayError(result, "play");
}

/** Pause; a missing device is treated as already-paused (idempotent). */
export async function pausePlayback(accessToken: string): Promise<void> {
  const result = await playerRequest(accessToken, "PUT", "/me/player/pause");
  if (
    result.status === 200 ||
    result.status === 202 ||
    result.status === 204 ||
    result.status === 404
  ) {
    return;
  }
  // 403 "already paused" style restriction errors are also fine to ignore.
  if (result.status === 403) return;
  throwPlayError(result, "pause");
}

/** Resume whatever is on the listener's player (no track override). */
export async function resumePlayback(accessToken: string): Promise<void> {
  const result = await playerRequest(accessToken, "PUT", "/me/player/play");
  if (result.status === 200 || result.status === 202 || result.status === 204) {
    return;
  }
  // "Already playing" restriction comes back as 403 — the goal state holds.
  if (result.status === 403 && !result.body.toLowerCase().includes("premium")) {
    return;
  }
  throwPlayError(result, "resume");
}

// ---------------------------------------------------------------------------
// Library (Liked Songs)
// ---------------------------------------------------------------------------

/**
 * Library failure with an honest machine-readable code. `insufficient_scope`
 * means the connection predates the library scopes — the fix is a reconnect
 * (fresh consent), which the route layer must surface, never swallow.
 */
export class SpotifyLibraryError extends Error {
  constructor(
    readonly code: "insufficient_scope" | "spotify_error",
    message: string,
  ) {
    super(message);
    this.name = "SpotifyLibraryError";
  }
}

function throwLibraryError(result: PlayerRequestResult, context: string): never {
  if (result.status === 403 && result.body.toLowerCase().includes("scope")) {
    throw new SpotifyLibraryError(
      "insufficient_scope",
      "This Spotify connection predates library access — reconnect to grant it",
    );
  }
  throw new SpotifyLibraryError(
    "spotify_error",
    `Spotify ${context} failed (${result.status}): ${result.body.slice(0, 200)}`,
  );
}

/** Save a track to the listener's Liked Songs (idempotent on Spotify's side). */
export async function saveTrackToLibrary(
  accessToken: string,
  trackId: string,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/me/tracks?ids=${encodeURIComponent(trackId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: [trackId] }),
    },
  );
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  throwLibraryError({ status: res.status, body }, "save track");
}

/** Whether a track is already in the listener's Liked Songs. */
export async function isTrackSaved(
  accessToken: string,
  trackId: string,
): Promise<boolean> {
  const res = await fetch(
    `${API_BASE}/me/tracks/contains?ids=${encodeURIComponent(trackId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throwLibraryError({ status: res.status, body }, "check saved");
  }
  const parsed = (await res.json()) as unknown;
  return Array.isArray(parsed) && parsed[0] === true;
}

// ---------------------------------------------------------------------------
// Recently-played history (journal sync)
// ---------------------------------------------------------------------------

export interface RecentTrack {
  /** ISO-8601 timestamp of when the track finished playing. */
  playedAt: string;
  title: string;
  artist: string;
  /** ISRC when Spotify provides it; null otherwise. */
  isrc: string | null;
  artworkUrl: string | null;
  /** Spotify track URI (e.g. `spotify:track:…`) */
  uri: string;
}

/**
 * Fetch up to 50 recently-played tracks from the listener's Spotify account.
 *
 * @param after  Optional Unix timestamp (ms). When supplied, only tracks played
 *               after that instant are returned. Omit to get the latest 50.
 *
 * Returns null when the scope is absent (pre-reconnect tokens) so callers can
 * silently no-op rather than throwing. Any other Spotify error is re-thrown.
 */
export async function fetchRecentlyPlayed(
  accessToken: string,
  after?: number,
): Promise<RecentTrack[] | null> {
  const params = new URLSearchParams({ limit: "50", type: "track" });
  if (after !== undefined) params.set("after", String(after));

  const res = await fetch(
    `${API_BASE}/me/player/recently-played?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (body.toLowerCase().includes("scope")) {
      return null;
    }
    throw new Error(`Spotify recently-played 403: ${body.slice(0, 200)}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Spotify recently-played failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as {
    items?: Array<{
      played_at?: string;
      track?: {
        name?: string;
        uri?: string;
        artists?: Array<{ name?: string }>;
        album?: { images?: Array<{ url?: string }> };
        external_ids?: { isrc?: string };
      };
    }>;
  };

  return (json.items ?? [])
    .map((item) => {
      const track = item.track;
      if (!track?.uri || !item.played_at) return null;
      const artworkUrl =
        (track.album?.images ?? []).sort(
          (a, b) => (b as { height?: number }).height! - (a as { height?: number }).height!,
        )[0]?.url ?? null;
      return {
        playedAt: item.played_at,
        title: track.name ?? "",
        artist: (track.artists ?? []).map((a) => a.name ?? "").filter(Boolean).join(", "),
        isrc: track.external_ids?.isrc ?? null,
        artworkUrl: artworkUrl ?? null,
        uri: track.uri,
      } satisfies RecentTrack;
    })
    .filter((t): t is RecentTrack => t !== null);
}

/** `spotify:track:ID` -> `ID`; null when the URI is not a track URI. */
export function trackIdFromUri(uri: string): string | null {
  const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri);
  return m ? m[1] : null;
}

export interface PlayerStateSnapshot {
  active: boolean;
  isPlaying: boolean;
  progressMs: number | null;
  durationMs: number | null;
  trackUri: string | null;
}

/** Snapshot of the listener's player; `active: false` when nothing anywhere. */
export async function getPlayerState(
  accessToken: string,
): Promise<PlayerStateSnapshot> {
  const result = await playerRequest(accessToken, "GET", "/me/player");
  if (result.status === 204 || !result.body) {
    return {
      active: false,
      isPlaying: false,
      progressMs: null,
      durationMs: null,
      trackUri: null,
    };
  }
  if (result.status !== 200) throwPlayError(result, "player state");
  try {
    const parsed = JSON.parse(result.body) as {
      is_playing?: boolean;
      progress_ms?: number | null;
      item?: { uri?: string; duration_ms?: number } | null;
    };
    return {
      active: true,
      isPlaying: parsed.is_playing ?? false,
      progressMs: parsed.progress_ms ?? null,
      durationMs: parsed.item?.duration_ms ?? null,
      trackUri: parsed.item?.uri ?? null,
    };
  } catch {
    return {
      active: false,
      isPlaying: false,
      progressMs: null,
      durationMs: null,
      trackUri: null,
    };
  }
}
