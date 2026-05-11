#!/usr/bin/env node
/**
 * Spotify Token Relay
 * ===================
 *
 * Why this exists:
 *   Spotify blocks https://open.spotify.com/get_access_token from every
 *   datacenter IP range (DigitalOcean, AWS, GCP, etc). Jam Bot runs on a
 *   droplet, so it can't call that endpoint directly. This tiny server
 *   runs on your home network (or any non-datacenter IP), holds the
 *   sp_dc cookie locally, calls Spotify from a residential IP, and
 *   returns the token to the bot over an authenticated HTTP request.
 *
 * What it does:
 *   GET /token   (Authorization: Bearer <RELAY_SECRET>)
 *     -> 200 { accessToken, accessTokenExpirationTimestampMs, isAnonymous }
 *     -> 401  if the bearer secret is missing or wrong
 *     -> 502  if Spotify rejected the cookie or returned non-2xx
 *     -> 503  if the cookie is missing from this machine's env
 *
 * Security:
 *   - The sp_dc cookie NEVER leaves this machine.
 *   - The relay only returns short-lived (~1h) Spotify access tokens.
 *   - Access is gated by a shared secret in the Authorization header.
 *   - Bind to 127.0.0.1 + tunnel (cloudflared/ngrok) so the port isn't
 *     exposed to the open internet directly. See README.md.
 *
 * Required env vars:
 *   SPOTIFY_SP_DC      — the sp_dc cookie value from open.spotify.com
 *                        (DevTools -> Application -> Cookies)
 *   RELAY_SECRET       — long random string; same value on the droplet's
 *                        SPOTIFY_TOKEN_RELAY_SECRET
 *
 * Optional env vars:
 *   RELAY_PORT         — default 8787
 *   RELAY_BIND         — default 127.0.0.1 (use 0.0.0.0 only if you
 *                        understand the implications, e.g. behind a
 *                        firewall + tunnel)
 */

import { createServer } from "node:http";

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const BIND = process.env.RELAY_BIND ?? "127.0.0.1";
const SECRET = process.env.RELAY_SECRET ?? "";
const SP_DC = process.env.SPOTIFY_SP_DC ?? "";

if (!SECRET) {
  console.error(
    "[relay] FATAL: RELAY_SECRET is not set. Generate one with:\n" +
      "        node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n" +
      "        Then export it here AND set the same value as SPOTIFY_TOKEN_RELAY_SECRET on the droplet.",
  );
  process.exit(1);
}
if (!SP_DC) {
  console.error(
    "[relay] FATAL: SPOTIFY_SP_DC is not set. Grab it from open.spotify.com\n" +
      "        DevTools -> Application -> Cookies -> sp_dc value.",
  );
  process.exit(1);
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Tiny in-process cache so we don't hammer Spotify on every call. The
// bot caches too, but if you restart the bot frequently this cushions
// it. Tokens are valid ~1 hour; we refresh when <60s remain.
let cached = null; // { token, expiresAt }

async function fetchToken() {
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return { ...cached, fromCache: true };
  }
  const res = await fetch(
    "https://open.spotify.com/get_access_token?reason=transport&productType=web_player",
    {
      headers: {
        Cookie: `sp_dc=${SP_DC}`,
        "User-Agent": BROWSER_UA,
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(
      `Spotify rejected get_access_token: ${res.status} ${body.slice(0, 200)}`,
    );
    err.upstreamStatus = res.status;
    throw err;
  }
  const json = await res.json();
  if (!json.accessToken || json.isAnonymous) {
    const err = new Error(
      "Spotify returned an anonymous token — sp_dc cookie is expired or invalid. Grab a fresh one.",
    );
    err.upstreamStatus = 401;
    throw err;
  }
  cached = {
    token: json.accessToken,
    expiresAt: json.accessTokenExpirationTimestampMs ?? Date.now() + 30 * 60_000,
    isAnonymous: false,
  };
  return { ...cached, fromCache: false };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function checkAuth(req) {
  const header = req.headers["authorization"] ?? "";
  const expected = `Bearer ${SECRET}`;
  if (header.length !== expected.length) return false;
  // Constant-time compare to thwart trivial timing probes.
  let diff = 0;
  for (let i = 0; i < header.length; i++) {
    diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "GET" || req.url !== "/token") {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  if (!checkAuth(req)) {
    sendJson(res, 401, { error: "bad or missing bearer token" });
    return;
  }
  try {
    const { token, expiresAt, fromCache } = await fetchToken();
    sendJson(res, 200, {
      accessToken: token,
      accessTokenExpirationTimestampMs: expiresAt,
      isAnonymous: false,
      fromCache,
    });
    console.log(
      `[relay] served token (cache=${fromCache}, expires in ${Math.round(
        (expiresAt - Date.now()) / 1000,
      )}s)`,
    );
  } catch (err) {
    const status = err.upstreamStatus ?? 502;
    console.error(`[relay] token fetch failed (${status}):`, err.message);
    sendJson(res, status === 401 ? 502 : 502, {
      error: err.message,
      upstreamStatus: err.upstreamStatus ?? null,
    });
  }
});

server.listen(PORT, BIND, () => {
  console.log(
    `[relay] listening on http://${BIND}:${PORT}\n` +
      `[relay] endpoints: GET /token (auth required), GET /health\n` +
      `[relay] expose this to your droplet via cloudflared/ngrok — see README.md`,
  );
});

process.on("SIGINT", () => {
  console.log("\n[relay] shutting down");
  server.close(() => process.exit(0));
});
