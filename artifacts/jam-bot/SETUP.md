# Jam Bot — Droplet Setup

Step-by-step guide for getting Jam Bot running on a fresh DigitalOcean droplet (or any Ubuntu/Debian box). Plan on ~30 minutes.

## 0. Prereqs

- A Linux box you control, running Ubuntu 22.04+ or Debian 12+.
- A **Spotify Premium** account that will be the Jam host (the account whose library/Jam plays).
- A Slack workspace where you have admin rights to install apps.
- An [OpenRouter](https://openrouter.ai/keys) account with an API key.

> **Note:** Spotify Jams are a Premium feature and the host needs to start the Jam from the official Spotify app at least once after the bot starts playing. The droplet only needs to keep the *playback* alive.

---

## 1. Create the Spotify developer app

1. Go to <https://developer.spotify.com/dashboard> and create a new app.
2. Set the redirect URI to `http://127.0.0.1:8888/callback` and save.
3. Note the **Client ID** and **Client Secret**.

## 2. Get your Spotify refresh token (one-time, locally)

Do this on your **laptop**, not the droplet — it spins up a tiny local web server for the OAuth callback.

```bash
git clone <this-repo>
cd <this-repo>/artifacts/jam-bot

# Or if you just copied the jam-bot folder somewhere standalone:
# cd jam-bot && npm install
pnpm install

cp .env.example .env
# Edit .env — fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET
pnpm run spotify:auth
```

The CLI prints a Spotify authorize URL. Open it, log in as the host account, approve, and the terminal will print:

```
=== SPOTIFY_REFRESH_TOKEN ===
AQ...
=============================
```

Paste it into your `.env` as `SPOTIFY_REFRESH_TOKEN`. You can keep using this `.env` on the droplet later.

## 3. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Pick your workspace, then paste the contents of [`deploy/slack-app-manifest.yaml`](./deploy/slack-app-manifest.yaml).
3. After creation:
   - **Basic Information → Signing Secret** → copy to `SLACK_SIGNING_SECRET`.
   - **Basic Information → App-Level Tokens → Generate Token and Scopes** → name it anything, scope `connections:write`. Copy the `xapp-...` token to `SLACK_APP_TOKEN`.
   - **Install App → Install to Workspace** → on success copy the **Bot User OAuth Token** (`xoxb-...`) to `SLACK_BOT_TOKEN`.
4. In Slack, invite the bot to your channel (`/invite @Jam Bot`).
5. Get the channel ID: right-click the channel → **View channel details** → bottom of the pane shows the ID (`C...`). Copy to `SLACK_CHANNEL_ID`.

## 4. Get an OpenRouter key

1. <https://openrouter.ai/keys> → create a key → copy to `OPENROUTER_API_KEY`.
2. Pick a model (default is `anthropic/claude-3.5-sonnet`). Cheaper alternatives that work well: `openai/gpt-4o-mini`, `meta-llama/llama-3.3-70b-instruct`.

## 5. Install everything on the droplet

SSH into the droplet as root or a sudoer.

### 5a. Node.js 20+ and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
sudo npm install -g pnpm
```

### 5b. librespot

Easiest is to install the Debian package (works on Ubuntu 22.04+):

```bash
sudo apt-get install -y librespot
which librespot   # should print /usr/bin/librespot
```

If your distro doesn't package it, build from source:

```bash
sudo apt-get install -y curl pkg-config libasound2-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source $HOME/.cargo/env
cargo install librespot
sudo cp ~/.cargo/bin/librespot /usr/bin/librespot
```

### 5c. Create a service user and deploy directory

```bash
sudo useradd --system --create-home --home-dir /opt/jam-bot --shell /usr/sbin/nologin jam
sudo mkdir -p /opt/jam-bot /opt/jam-bot/librespot-cache
sudo chown -R jam:jam /opt/jam-bot
```

The `librespot-cache` directory is where librespot will persist the host
account's Spotify Connect credentials after the one-time auth in step 6, so
the device stays signed in across reboots.

### 5d. Copy the bot

Either git clone the whole monorepo and symlink, or copy just `artifacts/jam-bot/` over:

```bash
# Option A: clone monorepo (the parent dir must be writable by `jam`)
sudo mkdir -p /opt/jam-bot-repo
sudo chown jam:jam /opt/jam-bot-repo
sudo -u jam git clone <your-fork-url> /opt/jam-bot-repo
sudo ln -sfn /opt/jam-bot-repo/artifacts/jam-bot /opt/jam-bot/app

# Option B: scp just the folder
# scp -r ./artifacts/jam-bot user@droplet:/tmp/
# sudo mv /tmp/jam-bot /opt/jam-bot/app
# sudo chown -R jam:jam /opt/jam-bot
```

Either way you should end up with `/opt/jam-bot/app/package.json` reachable.

```bash
cd /opt/jam-bot/app
sudo -u jam pnpm install --prod=false
```

### 5e. Drop in the `.env`

Copy the `.env` you built in steps 1-4 to `/opt/jam-bot/.env`:

```bash
sudo cp /tmp/.env /opt/jam-bot/.env
sudo chown jam:jam /opt/jam-bot/.env
sudo chmod 600 /opt/jam-bot/.env
```

### 5f. Install the systemd units

The provided units expect the app at `/opt/jam-bot/app` and the env at `/opt/jam-bot/.env`. Adjust if you used different paths.

```bash
sudo cp /opt/jam-bot/app/deploy/librespot.service /etc/systemd/system/
sudo cp /opt/jam-bot/app/deploy/jam-bot.service /etc/systemd/system/
# (The provided units assume the app at /opt/jam-bot/app and env at
#  /opt/jam-bot/.env. Edit them if you used different paths.)

sudo systemctl daemon-reload
sudo systemctl enable --now librespot.service
sudo systemctl enable --now jam-bot.service
```

Check status:

```bash
sudo systemctl status librespot.service
sudo systemctl status jam-bot.service
sudo journalctl -u jam-bot -f
```

You should see `Slack bot connected` and `Now-playing watcher started`.

## 6. Sign librespot into the host account, then start the Jam (one time)

The first time librespot starts on the droplet it has no credentials cached,
so it can't appear in your account's device list. There are two ways to
authenticate it; both only need to be done once.

### Option A — Zeroconf via Spotify Connect (recommended)

This works as long as your phone and the droplet are on the same network *or*
your phone Spotify can reach the librespot mDNS endpoint (it usually can,
because Spotify Connect goes through Spotify's servers).

1. Make sure `librespot.service` is running: `sudo systemctl status librespot`.
2. On your phone, signed in as the **host Premium account**, open Spotify and
   tap the device picker.
3. Pick **Jam Host**. Spotify will hand off the auth token to librespot, which
   writes it into `/opt/jam-bot/librespot-cache/credentials.json`.
4. Verify on the droplet:
   ```bash
   sudo ls /opt/jam-bot/librespot-cache/
   # should show credentials.json (and possibly files/ for audio cache)
   ```

### Option B — Explicit OAuth (if zeroconf doesn't reach the droplet)

```bash
sudo systemctl stop librespot
sudo -u jam /usr/bin/librespot \
  --cache /opt/jam-bot/librespot-cache \
  --name "Jam Host" \
  --backend pipe \
  --enable-oauth
# Open the printed URL in any browser, sign in as the HOST account, paste back
# the redirect URL when prompted, then ctrl-c.
sudo systemctl start librespot
```

### Then start the actual Jam

1. With the **Jam Host** device now visible in your phone's Spotify, tap the
   device picker and pick **Jam Host**. Playback transfers to the droplet.
2. Tap the Jam icon → **Start a Jam** → share the link with your friends.
3. Confirm Jam Bot also sees the device:
   ```bash
   sudo journalctl -u jam-bot -n 50 | grep -i "host"
   # should NOT contain 'Host device "Jam Host" not visible'
   ```
4. From now on, anyone in the Slack channel can `/play`, `/queue`, `/skip`,
   etc., and Jam Bot will keep things going even if everyone closes Spotify
   on their phones. After a reboot, librespot picks up its cached credentials
   automatically — no re-auth needed.

## 7. Verify

In your Slack channel:

```
/nowplaying
/play lo-fi study beats
hey jam, who produced this?
```

You should see a "Now playing" card, a confirmation that the song was queued/playing, and a friendly LLM answer in a thread reply.

---

## Troubleshooting

**Bot logs say `Host device "Jam Host" not visible to Spotify yet`.**
Three common causes:
1. librespot isn't running. Check `sudo systemctl status librespot` and
   `sudo journalctl -u librespot -n 50`.
2. The `--name` flag in `librespot.service` doesn't match `SPOTIFY_DEVICE_NAME`
   in `.env`.
3. **librespot has never been authenticated to the host account.** Without
   credentials in `/opt/jam-bot/librespot-cache/`, the device won't show up
   in the host account's Spotify device list. Re-do step 6.

**Bot posts "No active Spotify device" in the channel.**
The Jam ended (e.g. host account playback was paused on the librespot side for too long, or Spotify pushed the stream to another device). Open Spotify on your phone, transfer to **Jam Host**, and play one song to wake it back up.

**`/play` says "Couldn't find anything for X".**
Try a more specific query — Spotify search needs at least an artist or song fragment.

**LLM answers feel wrong / slow.**
Try a different `OPENROUTER_MODEL` in `.env` and `sudo systemctl restart jam-bot`.

**`librespot` fails to start with audio errors.**
The provided unit uses `--backend pipe` so it doesn't need a sound card, which is the right choice for a headless droplet (Jam listeners get audio through their own devices). If you're running this on a machine that *does* have a sound card and you want local audio, switch to `--backend alsa` or `--backend pulseaudio` and install the relevant packages.

**Slack socket keeps disconnecting.**
Confirm `SLACK_APP_TOKEN` is the `xapp-...` (App-Level) token, not the bot token, and that Socket Mode is enabled in the Slack app settings.

**Spotify auth errors after weeks of running.**
Refresh tokens for Spotify don't usually expire, but if they do (or if you change the Spotify app's scopes), re-run `pnpm run spotify:auth` locally and update `SPOTIFY_REFRESH_TOKEN` on the droplet, then `sudo systemctl restart jam-bot`.

---

## Updating

```bash
cd /opt/jam-bot/app
sudo -u jam git pull   # (if you cloned the repo)
sudo -u jam pnpm install --prod=false
sudo systemctl restart jam-bot
```
