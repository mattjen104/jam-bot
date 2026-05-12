# Jam Token Relay — Chrome Extension

Harvests the Spotify Web Player access token from your Spotify tab and
pushes it to the Jam Bot relay running on the same machine.

## Why

Spotify deprecated the unauthenticated `open.spotify.com/get_access_token`
endpoint (returns HTTP 403 "URL Blocked" via Varnish). The only reliable
way to obtain a Web Player token — required for the "Jam" feature — is
to grab it from a real, logged-in browser session. This extension does
that automatically.

## Setup (one-time, ~3 minutes)

### 1. Install the extension

1. Open `chrome://extensions/` in Chrome (or any Chromium-based browser:
   Edge, Brave, etc.)
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select this folder (`tools/spotify-token-relay/chrome-extension/`)
5. The extension should now appear with a green Spotify-style icon

### 2. Configure the relay URL and secret

1. Click the extension icon in the toolbar (or right-click → Options)
2. Fill in:
   - **Relay URL** — your Cloudflare tunnel URL, e.g.
     `https://appear-clubs-appendix-number.trycloudflare.com`
     (no trailing slash, same value as `SPOTIFY_TOKEN_RELAY_URL` on the
     droplet)
   - **Relay secret** — the 64-char hex string, same value as
     `RELAY_SECRET` on the relay AND `SPOTIFY_TOKEN_RELAY_SECRET` on the
     droplet
3. Click **Save**

### 3. Open Spotify Web Player

1. Open <https://open.spotify.com> in Chrome
2. Make sure you're logged in as the **Jam Host** account
3. Play any track briefly so the Web Player makes API calls — that
   triggers the extension to grab the token
4. Reopen the extension settings page; **Last status** should now show
   **ok** with a recent timestamp

That's it. Leave that tab open. The browser window can be minimised. The
extension automatically re-pushes the token every few minutes and
whenever Spotify rotates it (~hourly).

## How to verify it's working

- The extension's options page shows **Last status: ok** with a recent
  timestamp.
- The relay terminal logs `[relay] accepted new token from extension
  (expires in 3000s, len=...)`.
- From the droplet, `curl https://your-tunnel/health` reports
  `"hasToken": true`.
- In Slack, `start a jam` succeeds and posts a Jam invite link.

## Troubleshooting

- **Status is `unconfigured`** — fill in both Relay URL and secret on the
  options page and click Save.
- **Status is `error`** with `401` — the secret in the extension does
  not match `RELAY_SECRET` on the relay. Re-paste it carefully.
- **Status is `error`** with a network error — your Cloudflare tunnel
  may have changed URL (quick tunnels rotate on each restart). Restart
  cloudflared, copy the new URL, paste it into both the extension and
  the droplet's `.env`.
- **Status stays `pending` forever** — the Spotify Web Player tab isn't
  making API calls. Click anywhere in the player (play, change track) to
  force one. Make sure you opened `https://open.spotify.com`, not the
  desktop app.
- **Token push works but Slack still says manual instructions** — check
  the bot logs on the droplet (`sudo journalctl -u jam-bot -f`) for the
  actual error.

## Security

- The relay secret is stored in Chrome's local extension storage, scoped
  to this extension only. It never leaves your machine except in the
  `Authorization` header of POST requests to your own relay.
- The extension only reads `Authorization` headers from requests to
  Spotify hosts (`api.spotify.com`, `api-partner.spotify.com`,
  `*.spclient.spotify.com`). It does not modify any requests.
- The token is short-lived (~50 minutes) and is the same one Spotify's
  own Web Player uses — no extra capability is granted.
