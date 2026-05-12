import { config } from "../config.js";
import { logger } from "../logger.js";

/**
 * Spotify Jam (a.k.a. "social listening session") is the in-app feature where
 * multiple Spotify users join the same playback queue and can each add tracks.
 *
 * Honest status: Spotify has NOT published a public Web API for starting or
 * managing a Jam. The only way to programmatically create one is via an
 * undocumented endpoint that the Spotify desktop/mobile/web clients use
 * internally, and that endpoint requires an "internal" access token derived
 * from the `sp_dc` browser cookie (NOT the standard OAuth refresh token).
 *
 * This module:
 *   - When `SPOTIFY_SP_DC` is configured, attempts to create a Jam via the
 *     unofficial endpoint and returns the share URL on success.
 *   - When unset or the call fails, returns a fallback that explains how to
 *     start the Jam by hand from the host device, plus a `spotify:` deep
 *     link that opens the Spotify client.
 *
 * The unofficial endpoint may break at any time. The fallback message always
 * works and is the *recommended* path for most setups.
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
 * Fetch an internal Spotify access token, either via the home-network
 * relay (preferred — see tools/spotify-token-relay) or by calling
 * open.spotify.com directly. The direct path returns 403 "URL Blocked"
 * from datacenter IPs, so on a cloud droplet you almost certainly want
 * the relay path.
 */
async function fetchInternalAccessToken(): Promise<string> {
  if (cachedInternalToken && Date.now() < cachedInternalToken.expiresAt - 60_000) {
    return cachedInternalToken.token;
  }

  let json: InternalTokenResponse;

  if (config.SPOTIFY_TOKEN_RELAY_URL) {
    // ---- Relay path (works from datacenter IPs) ------------------------
    if (!config.SPOTIFY_TOKEN_RELAY_SECRET) {
      throw new Error(
        "SPOTIFY_TOKEN_RELAY_URL is set but SPOTIFY_TOKEN_RELAY_SECRET is missing. Set both, matching the relay's RELAY_SECRET.",
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
    json = (await res.json()) as InternalTokenResponse;
  } else {
    // ---- Direct path (only works from residential IPs) -----------------
    if (!config.SPOTIFY_SP_DC) {
      throw new Error(
        "no token source configured — set SPOTIFY_TOKEN_RELAY_URL (recommended for cloud droplets) or SPOTIFY_SP_DC",
      );
    }
    const res = await fetch(
      "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
      {
        headers: {
          Cookie: `sp_dc=${config.SPOTIFY_SP_DC}`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
      },
    );
    if (!res.ok) {
      throw new Error(
        `get_access_token failed: ${res.status} ${res.statusText}` +
          (res.status === 403
            ? " (Spotify blocks this endpoint from datacenter IPs — set up tools/spotify-token-relay on a home machine)"
            : ""),
      );
    }
    json = (await res.json()) as InternalTokenResponse;
  }

  if (!json.accessToken || json.isAnonymous) {
    throw new Error(
      "internal token endpoint returned an anonymous token — your sp_dc cookie has likely expired. Grab a fresh one from open.spotify.com.",
    );
  }
  cachedInternalToken = {
    token: json.accessToken,
    expiresAt: json.accessTokenExpirationTimestampMs ?? Date.now() + 30 * 60_000,
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
 * Look up the host's currently-active Jam session, if one exists. Returns
 * null when there is no active session, throws on auth/network failures
 * so the caller can decide whether to fall back or surface the error.
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

/**
 * Best-effort programmatic Jam start. Behavior:
 *   1. If SPOTIFY_SP_DC is unset -> return ok:false (caller shows manual
 *      instructions).
 *   2. Look up the host's current Jam. If one already exists, return its
 *      join URL with `existed: true` — no creation attempt, no Spotify
 *      "you already have a Jam" rejection.
 *   3. Otherwise POST to create one and return the new join URL with
 *      `existed: false`.
 *
 * Always returns a result tuple — never throws.
 */
export async function startSpotifyJam(): Promise<JamStartResult> {
  if (!config.SPOTIFY_TOKEN_RELAY_URL && !config.SPOTIFY_SP_DC) {
    return {
      ok: false,
      reason:
        "no Spotify internal-token source configured — set SPOTIFY_TOKEN_RELAY_URL (recommended) or SPOTIFY_SP_DC",
    };
  }
  let token: string;
  try {
    token = await fetchInternalAccessToken();
  } catch (err) {
    cachedInternalToken = null;
    return { ok: false, reason: String(err) };
  }

  // Step 1: is there already a live Jam? If yes, just hand back its URL.
  try {
    const existing = await getCurrentJam(token);
    if (existing) {
      logger.info("Spotify Jam already active; returning existing join URL", {
        sessionId: existing.sessionId,
      });
      return {
        ok: true,
        joinUrl: existing.joinUrl,
        sessionId: existing.sessionId,
        existed: true,
      };
    }
  } catch (err) {
    // Don't fail the whole command on a lookup glitch — fall through and
    // try the create. The create path will surface the actual error if it
    // also fails.
    logger.warn("Spotify current-session lookup failed; trying create", {
      error: String(err),
    });
  }

  // Step 2: no active session, try to create one.
  try {
    const res = await fetch(
      "https://spclient.wg.spotify.com/social-connect/v3/sessions/current_or_new?local_device_id=jam-bot",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": BROWSER_UA,
        },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("Spotify Jam create failed", {
        status: res.status,
        body: body.slice(0, 200),
      });
      return {
        ok: false,
        reason: `Spotify rejected the Jam-create request (${res.status}). The unofficial endpoint may have changed, or the host needs an active playback device.`,
      };
    }
    const data = (await res.json()) as SessionResponse;
    const url = extractJoinUrl(data);
    if (!url || !data.session_id) {
      return {
        ok: false,
        reason: "Spotify response missing join URL — endpoint shape may have changed",
      };
    }
    return {
      ok: true,
      joinUrl: url,
      sessionId: data.session_id,
      existed: false,
    };
  } catch (err) {
    return { ok: false, reason: `Network error: ${String(err)}` };
  }
}

/**
 * The "no-API" instructions we hand back when programmatic start isn't
 * available. Always works — the host opens Spotify on their phone, taps the
 * Connect-to-device speaker icon, picks the librespot host, and starts a
 * Jam from there.
 */
export function manualJamInstructions(): string {
  return (
    `:notes: Spotify hasn't published a public Jam API, so I can't start one for you directly. ` +
    `To open a Jam:\n` +
    `  1. Open Spotify on your phone (host account).\n` +
    `  2. Tap the speaker / Connect icon and select \`${config.SPOTIFY_DEVICE_NAME}\`.\n` +
    `  3. Tap the Connect icon again -> *Start a Jam* -> share the join link.\n\n` +
    `Friends in this Slack can keep using \`/play\`, \`/queue\`, and \`/skip\` regardless — those don't need a Jam session, they go straight to the host device.\n\n` +
    `_(Tip: set \`SPOTIFY_SP_DC\` in the bot's .env to your sp_dc browser cookie from open.spotify.com and I'll try to start the Jam programmatically next time. It's an undocumented endpoint and may break, so the manual flow above is always the fallback.)_`
  );
}
