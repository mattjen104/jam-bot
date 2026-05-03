/**
 * One-time Spotify OAuth handshake.
 *
 * Run on your local machine (not the droplet):
 *   pnpm install
 *   pnpm run spotify:auth
 *
 * Spotify app must have http://127.0.0.1:8888/callback in its redirect URIs.
 * Paste the printed refresh token into your .env as SPOTIFY_REFRESH_TOKEN.
 */
import "dotenv/config";
import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const PORT = 8888;

const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "streaming",
].join(" ");

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("state", state);

const server = http.createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/callback") {
    res.writeHead(404).end("Not found");
    return;
  }
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || returnedState !== state) {
    res.writeHead(400).end("Missing code or state mismatch");
    return;
  }

  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    });
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      },
      body,
    });
    const json = (await tokenRes.json()) as {
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!tokenRes.ok || !json.refresh_token) {
      res
        .writeHead(500)
        .end(
          `Token exchange failed: ${json.error_description ?? json.error ?? tokenRes.status}`,
        );
      console.error("Token exchange failed:", json);
      process.exit(1);
    }

    res.writeHead(200, { "Content-Type": "text/html" }).end(
      `<html><body style="font-family:sans-serif;padding:40px">
        <h2>Done — you can close this tab.</h2>
        <p>The refresh token has been printed in your terminal. Paste it into <code>.env</code> as <code>SPOTIFY_REFRESH_TOKEN</code>.</p>
      </body></html>`,
    );

    console.log("\n=== SPOTIFY_REFRESH_TOKEN ===");
    console.log(json.refresh_token);
    console.log("=============================\n");
    console.log("Paste this into your .env file as SPOTIFY_REFRESH_TOKEN.");
    setTimeout(() => process.exit(0), 250);
  } catch (err) {
    res.writeHead(500).end(String(err));
    console.error(err);
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("\nOpen this URL in your browser to authorize:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for callback on http://127.0.0.1:8888/callback ...\n");
});
