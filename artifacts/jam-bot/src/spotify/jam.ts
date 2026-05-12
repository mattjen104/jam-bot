import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Spotify Jam (a.k.a. "social listening session") is the in-app feature
 * where multiple Spotify users join the same playback queue. Spotify
 * has not published a public Web API for *creating* a Jam — only the
 * desktop, mobile, and web clients can do it, and the create endpoint
 * rejects Web Player tokens (returns 405).
 *
 * Architecture:
 *   - Jam Host runs full-time on the user's home Windows PC (Spotify
 *     Desktop, the Python relay, and the cloudflared tunnel).
 *   - The bot fetches a Web Player token from the relay (harvested by
 *     the companion Chrome extension) and uses it for the cheap
 *     read-only "is there already a Jam?" lookup.
 *   - When no Jam is active, the bot POSTs to the relay's /jam/start
 *     endpoint, which spawns a UI-automation script that drives the
 *     Spotify Desktop client (pywinauto + UIA, with a vision-model
 *     fallback) and returns the resulting share URL.
 *   - manualJamInstructions() is the final fallback when the relay
 *     itself is unreachable or the driver fails.
 */

export type JamStartResult =
  | { ok: true; joinUrl: string; sessionId: string; existed: boolean }
  | { ok: false; reason: string };

interface InternalTokenResponse {
  clientId?: string;
  accessToken?: string;
  accessTokenExpirationTimestampMs?: number;
  isAnonymous?: boolean;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedInternalToken: CachedToken | null = null;

/**
 * Fetch an internal Spotify access token via the home-network relay.
 * The legacy direct-from-Spotify path was removed: Spotify now returns
 * 403 "URL Blocked" via Varnish for any non-browser request to
 * `open.spotify.com/get_access_token`, regardless of source IP.
 */
async function fetchInternalAccessToken(): Promise<string> {
  if (
    cachedInternalToken &&
    Date.now() < cachedInternalToken.expiresAt - 60_000
  ) {
    return cachedInternalToken.token;
  }

  if (!config.SPOTIFY_TOKEN_RELAY_URL || !config.SPOTIFY_TOKEN_RELAY_SECRET) {
    throw new Error(
      "SPOTIFY_TOKEN_RELAY_URL and SPOTIFY_TOKEN_RELAY_SECRET must both be set — see tools/spotify-token-relay/README.md.",
    );
  }
  const relayUrl = `${config.SPOTIFY_TOKEN_RELAY_URL.replace(/\/$/, "")}/token`;
  const res = await fetch(relayUrl, {
    headers: {
      Authorization: `Bearer ${config.SPOTIFY_TOKEN_RELAY_SECRET}`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `token relay returned ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as InternalTokenResponse;

  if (!json.accessToken || json.isAnonymous) {
    throw new Error(
      "relay returned an anonymous token — the host browser probably isn't logged into Spotify. Open the Spotify Web Player tab on the host and try again.",
    );
  }
  cachedInternalToken = {
    token: json.accessToken,
    expiresAt:
      json.accessTokenExpirationTimestampMs ?? Date.now() + 30 * 60_000,
  };
  return cachedInternalToken.token;
}

interface SessionResponse {
  session_id?: string;
  join_session_token?: string;
  join_session_url?: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function extractJoinUrl(data: SessionResponse): string | null {
  if (data.join_session_url) return data.join_session_url;
  if (data.join_session_token) {
    return `https://open.spotify.com/jam/${data.join_session_token}`;
  }
  return null;
}

/**
 * Look up the host's currently-active Jam session, if one exists.
 * Returns null when there is no active session, throws on auth/network
 * failures so the caller can decide whether to fall back.
 */
async function getCurrentJam(
  token: string,
): Promise<{ joinUrl: string; sessionId: string } | null> {
  const res = await fetch(
    "https://spclient.wg.spotify.com/social-connect/v3/sessions/current",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": BROWSER_UA,
      },
    },
  );
  // 404 = no active session. Anything else non-2xx is a real failure.
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `current-session lookup failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }
  const data = (await res.json()) as SessionResponse;
  const url = extractJoinUrl(data);
  if (!url || !data.session_id) return null;
  return { joinUrl: url, sessionId: data.session_id };
}

interface RelayJamStartResponse {
  ok?: boolean;
  joinUrl?: string;
  reason?: string;
}

/**
 * Ask the relay's UI-automation driver to start a fresh Jam on the host
 * Spotify Desktop client. The relay subprocess can take ~30s in the
 * worst case (vision fallback), so we use a slightly longer client-side
 * deadline.
 */
async function startJamViaRelay(): Promise<JamStartResult> {
  const baseUrl = config.SPOTIFY_TOKEN_RELAY_URL?.replace(/\/$/, "") ?? "";
  if (!baseUrl || !config.SPOTIFY_TOKEN_RELAY_SECRET) {
    return {
      ok: false,
      reason:
        "SPOTIFY_TOKEN_RELAY_URL / SPOTIFY_TOKEN_RELAY_SECRET not set — point them at your home relay.",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/jam/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.SPOTIFY_TOKEN_RELAY_SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    });
  } catch (err) {
    return {
      ok: false,
      reason: `relay /jam/start network error: ${String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text().catch(() => "");
  if (!res.ok && res.status !== 504) {
    return {
      ok: false,
      reason: `relay /jam/start returned ${res.status}: ${bodyText.slice(0, 200)}`,
    };
  }

  let data: RelayJamStartResponse;
  try {
    data = JSON.parse(bodyText) as RelayJamStartResponse;
  } catch {
    return {
      ok: false,
      reason: `relay /jam/start returned non-JSON: ${bodyText.slice(0, 200)}`,
    };
  }

  if (!data.ok || !data.joinUrl) {
    return {
      ok: false,
      reason:
        data.reason ?? "relay returned ok:false with no reason",
    };
  }

  // The driver returns the URL but no session_id — derive a stable
  // identifier from the URL so /wrapped et al. can reference it.
  const sessionId =
    data.joinUrl.split("/").filter(Boolean).pop() ?? data.joinUrl;
  return { ok: true, joinUrl: data.joinUrl, sessionId, existed: false };
}

/**
 * Best-effort programmatic Jam start. Behavior:
 *   1. If neither relay nor sp_dc is configured, return ok:false (caller
 *      shows manual instructions).
 *   2. Use the harvested Web Player token to look up the host's current
 *      Jam. If one already exists, return its join URL with
 *      `existed: true` — no need to invoke the UI driver.
 *   3. Otherwise POST to the relay's /jam/start endpoint, which drives
 *      Spotify Desktop on the home PC and returns the resulting URL.
 *
 * Always returns a result tuple — never throws.
 */
export async function startSpotifyJam(): Promise<JamStartResult> {
  if (!config.SPOTIFY_TOKEN_RELAY_URL || !config.SPOTIFY_TOKEN_RELAY_SECRET) {
    return {
      ok: false,
      reason:
        "Spotify token relay is not configured — set SPOTIFY_TOKEN_RELAY_URL and SPOTIFY_TOKEN_RELAY_SECRET (see tools/spotify-token-relay/README.md).",
    };
  }

  // Step 1: cheap read-only lookup. If there's already a Jam, hand back
  // the URL without bothering the UI driver.
  let token: string | null = null;
  try {
    token = await fetchInternalAccessToken();
  } catch (err) {
    cachedInternalToken = null;
    logger.warn("Spotify token fetch failed; will still try relay /jam/start", {
      error: String(err),
    });
  }

  if (token) {
    try {
      const existing = await getCurrentJam(token);
      if (existing) {
        logger.info(
          "Spotify Jam already active; returning existing join URL",
          { sessionId: existing.sessionId },
        );
        return {
          ok: true,
          joinUrl: existing.joinUrl,
          sessionId: existing.sessionId,
          existed: true,
        };
      }
    } catch (err) {
      logger.warn(
        "Spotify current-session lookup failed; trying relay /jam/start",
        { error: String(err) },
      );
    }
  }

  // Step 2: ask the home PC's relay to drive Spotify Desktop into
  // starting a Jam.
  const result = await startJamViaRelay();
  if (!result.ok) {
    logger.warn("relay /jam/start failed", { reason: result.reason });
  }
  return result;
}

/**
 * The "no-API" instructions we hand back when the programmatic path is
 * unavailable. Always works — the host opens Spotify on their phone or
 * desktop, taps the Connect speaker icon, and starts a Jam from there.
 */
export function manualJamInstructions(): string {
  return (
    `:notes: I couldn't start the Jam automatically. ` +
    `To open one by hand:\n` +
    `  1. On the home PC (or your phone) make sure Spotify is signed into the Jam Host account and currently playing something.\n` +
    `  2. Click the speaker / Connect icon in the bottom-right of Spotify.\n` +
    `  3. Click the same icon again -> *Start a Jam* -> copy the share link and paste it back here.\n\n` +
    `_(If this keeps happening, the home PC's Jam relay is probably down — check that the relay terminal and cloudflared tunnel are still running, and that Spotify Desktop is signed in. See ` +
    `tools/spotify-token-relay/HOST_SETUP_WINDOWS.md for the host troubleshooting checklist.)_`
  );
}
