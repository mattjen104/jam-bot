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
  | { ok: true; joinUrl: string; sessionId: string }
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

async function fetchInternalAccessToken(spDc: string): Promise<string> {
  if (cachedInternalToken && Date.now() < cachedInternalToken.expiresAt - 60_000) {
    return cachedInternalToken.token;
  }
  const res = await fetch(
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
    {
      headers: {
        Cookie: `sp_dc=${spDc}`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `get_access_token failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as InternalTokenResponse;
  if (!json.accessToken || json.isAnonymous) {
    throw new Error(
      "get_access_token returned an anonymous token — your sp_dc cookie has likely expired. Grab a fresh one from open.spotify.com.",
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

/**
 * Best-effort programmatic Jam start. Returns ok:false with a human-readable
 * reason when the unofficial endpoint isn't available — caller should then
 * post the manual fallback instructions.
 */
export async function startSpotifyJam(): Promise<JamStartResult> {
  if (!config.SPOTIFY_SP_DC) {
    return {
      ok: false,
      reason:
        "no SPOTIFY_SP_DC cookie configured — Spotify hasn't published a public Jam API",
    };
  }
  let token: string;
  try {
    token = await fetchInternalAccessToken(config.SPOTIFY_SP_DC);
  } catch (err) {
    cachedInternalToken = null;
    return { ok: false, reason: String(err) };
  }
  try {
    const res = await fetch(
      "https://spclient.wg.spotify.com/social-connect/v2/sessions/current_or_new?local_device_id=jam-bot",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
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
    const url =
      data.join_session_url ??
      (data.join_session_token
        ? `https://open.spotify.com/jam/${data.join_session_token}`
        : null);
    if (!url || !data.session_id) {
      return {
        ok: false,
        reason: "Spotify response missing join URL — endpoint shape may have changed",
      };
    }
    return { ok: true, joinUrl: url, sessionId: data.session_id };
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
