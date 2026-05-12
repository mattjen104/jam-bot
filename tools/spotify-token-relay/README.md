# Spotify Token Relay

A small Python script + companion Chrome extension that lets Jam Bot
start Spotify Jams from your DigitalOcean droplet by harvesting the
Web Player access token from your home browser and serving it over a
Cloudflare tunnel.

## Why you need this

Spotify deprecated the unauthenticated `open.spotify.com/get_access_token`
endpoint — it now returns HTTP 403 "URL Blocked" via Varnish for any
non-browser request, regardless of source IP, cookies, or headers.

The only reliable way to get a Web Player token (which is required for
the **Jam** feature — there is no public OAuth scope for Jams) is to
extract it from a real, logged-in browser session.

This relay does that in three pieces:

1. **Chrome extension** (`chrome-extension/`) — runs in your browser,
   watches your open Spotify Web Player tab, grabs the access token
   whenever Spotify rotates it, and POSTs it to the relay.
2. **Python relay** (`jam_relay.py`) — runs on the same machine, holds
   the latest token in memory, serves it to the droplet over an
   authenticated HTTP request.
3. **Cloudflare tunnel** (`cloudflared`) — exposes the relay's
   `localhost:8787` to the public internet so the droplet can reach it.

The token is the same one Spotify's own Web Player uses (~50 minutes,
auto-rotated). It never grants any capability beyond what your browser
already has.

## What you need

- A computer that stays on with **Chrome (or any Chromium browser)
  open**, including a Spotify Web Player tab logged in as the Jam Host
  account. The window can be minimised.
- Python 3.8+ (most Windows machines have it — check `python --version`).
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  (free, no signup needed for quick tunnels).

The legacy Node version (`index.mjs`) talked to Spotify directly and no
longer works because of the Varnish block. It's kept in the repo only
for reference; do not use it.

## One-time setup

### 1. Get the files onto your home machine

```bash
git clone https://github.com/mattjen104/jam-bot.git
cd jam-bot/tools/spotify-token-relay
```

Or just download `jam_relay.py` and the `chrome-extension/` folder
individually from GitHub.

### 2. Generate a shared secret

```powershell
# PowerShell:
python -c "import secrets; print(secrets.token_hex(32))"
```

Save the 64-character hex string. You will use this **same value** in
three places:

- `RELAY_SECRET` env var when starting the relay (this machine)
- The Chrome extension's options page (this machine)
- `SPOTIFY_TOKEN_RELAY_SECRET` in the droplet's `.env`

### 3. Start the relay

```powershell
# PowerShell (Windows):
$env:RELAY_SECRET = "paste-your-secret-here"
python jam_relay.py
```

You should see:

```
[relay] listening on http://127.0.0.1:8787
[relay] endpoints: POST /admin/set-token, GET /token, GET /health
[relay] waiting for the Chrome extension to push the first token...
```

Leave this terminal open.

### 4. Start the Cloudflare tunnel

In a second terminal:

```powershell
cloudflared tunnel --url http://localhost:8787
```

Cloudflared will print a URL like
`https://appear-clubs-appendix-number.trycloudflare.com`. **Copy this
URL** — you'll need it for the droplet AND the Chrome extension.

> Quick tunnel URLs rotate every time you restart cloudflared. If you
> restart, update both the droplet's `.env` and the extension's
> options page with the new URL.

### 5. Install the Chrome extension

See [`chrome-extension/README.md`](chrome-extension/README.md) for full
instructions. The short version:

1. `chrome://extensions/` → toggle Developer mode → **Load unpacked** →
   select the `chrome-extension/` folder
2. Click the extension icon → fill in the Cloudflare URL (from step 4)
   and the secret (from step 2) → **Save**
3. Open <https://open.spotify.com>, log in as the Jam Host, play any
   track briefly to trigger an API call
4. Reopen the extension settings; **Last status** should read **ok**

### 6. Configure the droplet

In the droplet's `/opt/jam-bot/.env`, set (or update):

```ini
SPOTIFY_TOKEN_RELAY_URL=https://appear-clubs-appendix-number.trycloudflare.com
SPOTIFY_TOKEN_RELAY_SECRET=paste-the-same-64-char-hex-here
```

You can **remove** the old `SPOTIFY_SP_DC` variable from the droplet —
the new architecture doesn't use it.

Then restart the bot:

```bash
sudo systemctl restart jam-bot
```

### 7. Test

In Slack, DM the bot `start a jam`. It should reply with a Jam invite
link instead of manual instructions.

## Verifying each piece

```bash
# From the droplet, the relay is reachable and has a token:
curl https://your-tunnel.trycloudflare.com/health
# -> {"ok": true, "hasToken": true, "expiresInSec": 2950}

# The droplet can fetch the token (replace SECRET):
curl -H "Authorization: Bearer SECRET" \
     https://your-tunnel.trycloudflare.com/token
# -> {"accessToken": "...", "expires...": ..., "isAnonymous": false, "fromCache": true}
```

If `hasToken` is `false`, the Chrome extension has not pushed a token
yet — open the extension settings page and check the status, or click
around the Spotify Web Player tab to force an API call.

## Troubleshooting

- **`/health` returns `hasToken: false`** — the extension hasn't pushed
  yet. Open the extension options to see its last status / error.
- **`/token` returns `503 no fresh token available`** — the last pushed
  token has expired. Make sure the Spotify tab is still open and active
  in your browser; the extension auto-refreshes every few minutes.
- **Extension status is `error 401`** — secret mismatch. Re-paste it on
  the extension page exactly as it appears in the relay env var.
- **Extension status is a network error** — your Cloudflare quick
  tunnel URL changed (it rotates on every cloudflared restart). Update
  both the extension and the droplet `.env` with the new URL.
- **Bot logs show `token relay returned 503`** — see above; relay has
  no fresh token from the extension.
- **Bot logs show `token relay returned 401`** — `RELAY_SECRET` on the
  relay does not match `SPOTIFY_TOKEN_RELAY_SECRET` on the droplet.

## Security notes

- The relay binds to `127.0.0.1` by default and is only reachable
  externally through your Cloudflare tunnel.
- All write/read endpoints require the `RELAY_SECRET` bearer token.
- The Chrome extension only reads `Authorization` headers from
  Spotify-domain requests; it never modifies requests and never
  exfiltrates anything besides the access token to the relay you
  configured.
- The token is the same short-lived (~50 min) Web Player token your
  browser already holds; the relay grants no extra capability.
