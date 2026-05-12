# Spotify Token Relay

A tiny ~150-line Node script that lets Jam Bot start Spotify Jams from your
DigitalOcean droplet by routing one specific request through your home
network.

## Why you need this

Spotify blocks `https://open.spotify.com/get_access_token` from every
datacenter IP. Your droplet sits in a DigitalOcean range, so when `/jam`
runs, that call returns 403 "URL Blocked" and the bot falls back to manual
instructions.

This relay runs on a residential IP (your home computer, a Raspberry Pi,
anything **not** in a datacenter). The droplet asks the relay for a token
over a tunneled HTTPS request, the relay calls Spotify from your home IP
(which works), and hands the token back. From then on, `/jam` works
programmatically end-to-end.

The `sp_dc` cookie **stays on your home machine** — it never goes to the
droplet. The droplet only ever sees short-lived (~1 hour) access tokens.

## What you need

- A computer that can stay on (sleep is OK, but `/jam` will fall back
  while it's asleep).
- **Either** Node 20+ **or** Python 3.8+ — the relay ships in two
  flavors and they do exactly the same thing. Pick whichever is already
  installed:
  - **Python (`jam_relay.py`)** — single file, zero installs, just
    `python jam_relay.py`. Easiest if you already have Python (most
    Windows machines do — check `python --version`).
  - **Node (`index.mjs`)** — single file, zero installs, just
    `npm start`. Easiest if you already have Node.
- A way to expose `localhost:8787` to your droplet. The easiest is
  [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  (free, no signup needed for quick tunnels). `ngrok` also works.

## One-time setup

### 1. Get the files onto your home machine

Easiest: clone the repo and just use this folder.

```bash
git clone https://github.com/mattjen104/jam-bot.git
cd jam-bot/tools/spotify-token-relay
```

### 2. Generate a shared secret

This is the password the droplet uses to talk to your relay. Run once and
save the output — you'll paste it in two places.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

You'll get something like `7f3a...` (64 chars). Copy it.

### 3. Grab your sp_dc cookie

1. Open <https://open.spotify.com> in a browser logged in as the host account.
2. Open DevTools (F12 or right-click -> Inspect).
3. Application tab -> Cookies -> `https://open.spotify.com`.
4. Find the row named `sp_dc`. Copy its **Value** (long string).

This cookie expires every ~1 year. When `/jam` starts failing again
months from now, just grab a fresh one and restart the relay.

### 4. Set env vars and start the relay

In the `tools/spotify-token-relay` folder, pick **one** flavor:

**Python (recommended on Windows — no install required):**

```powershell
# PowerShell (Windows)
$env:SPOTIFY_SP_DC = "paste-the-sp_dc-cookie-here"
$env:RELAY_SECRET  = "paste-the-generated-secret-here"
python jam_relay.py
```

```bash
# bash / zsh (macOS, Linux)
SPOTIFY_SP_DC="paste-the-sp_dc-cookie-here" \
RELAY_SECRET="paste-the-generated-secret-here" \
python3 jam_relay.py
```

**Node (alternative):**

```bash
SPOTIFY_SP_DC="paste-the-sp_dc-cookie-here" \
RELAY_SECRET="paste-the-generated-secret-here" \
npm start
```

Either way, you should see:

```
[relay] listening on http://127.0.0.1:8787
[relay] endpoints: GET /token (auth required), GET /health
```

Quick sanity check from another terminal on the same machine:

```bash
curl http://127.0.0.1:8787/health
# -> {"ok":true}
```

### 5. Expose the relay to your droplet via a tunnel

The relay binds to `127.0.0.1` only — that means nothing on the open
internet can reach it directly. We tunnel it out through Cloudflare.

Install cloudflared:
- macOS: `brew install cloudflared`
- Linux: see <https://pkg.cloudflare.com/index.html>
- Windows: download the .exe from Cloudflare

In **another terminal** (leave the relay running in the first):

```bash
cloudflared tunnel --url http://localhost:8787
```

After a few seconds it prints something like:

```
Your quick Tunnel has been created! Visit it at:
https://random-words-1234.trycloudflare.com
```

Copy that URL. That's your relay's public address.

> **Note**: quick tunnels get a new URL every restart. For a stable URL,
> create a named tunnel — see Cloudflare's docs. For now, the quick
> tunnel is fine to test.

### 6. Tell the droplet about the relay

SSH into the droplet:

```bash
ssh root@146.190.33.157
sudo nano /opt/jam-bot/.env
```

Add (or update) these lines:

```env
SPOTIFY_TOKEN_RELAY_URL=https://random-words-1234.trycloudflare.com
SPOTIFY_TOKEN_RELAY_SECRET=paste-the-same-secret-from-step-2
```

You can now **remove `SPOTIFY_SP_DC`** from the droplet's `.env` — the
cookie lives on your home machine only.

Restart the bot:

```bash
sudo systemctl restart jam-bot
```

### 7. Try it

In Slack, DM the bot:

```
start a jam
```

You should get back a real `open.spotify.com/jam/...` link.

## Keeping it running

- **Relay must be running** when someone uses `/jam`. If it's down or
  your laptop is asleep, `/jam` falls back to manual instructions —
  same as before.
- **Auto-start on boot** (optional, recommended for a Pi):
  - macOS: use `launchd` (see Apple docs) or just `pm2` if you already use it.
  - Linux: systemd unit, similar to the bot's own unit on the droplet.
  - Windows: NSSM or Task Scheduler.

## Security notes

- The relay refuses any request without the correct `Authorization: Bearer <RELAY_SECRET>` header.
- It binds to `127.0.0.1` by default — only the local machine and the
  cloudflared tunnel can reach it.
- The `sp_dc` cookie never leaves your home machine. The droplet only
  ever sees access tokens, which expire in about an hour.
- Treat the relay secret like any other password. Don't paste it in chat,
  don't commit it to git.

## Troubleshooting

- **`/jam` still falls back to manual** -> Check the bot's log on the
  droplet: `sudo journalctl -u jam-bot -n 50 | grep -i jam`. The reason
  string tells you exactly what failed (relay unreachable, wrong secret,
  expired cookie, etc).
- **Relay logs `Spotify rejected get_access_token: 401`** -> sp_dc cookie
  is expired. Grab a fresh one (step 3) and restart the relay.
- **`fetch failed`** in the bot log -> Cloudflared tunnel URL changed
  (quick tunnels rotate on restart). Re-copy the new URL into the
  droplet's `.env` and restart the bot. Or set up a named tunnel for a
  stable URL.
- **Want to test locally without a tunnel** -> Set
  `SPOTIFY_TOKEN_RELAY_URL=http://127.0.0.1:8787` on a machine running
  both the relay and the bot.
