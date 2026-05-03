# Jam Bot — Quick Start

A 15-minute path from zero to a Slack-controlled Spotify Jam running on your droplet. For background, options, and troubleshooting, see [`SETUP.md`](./SETUP.md).

---

## Part 1 — Setup (do this once)

### 1. Get four sets of credentials

| Service | What you need | Where |
| --- | --- | --- |
| **Spotify** (Premium) | Client ID + Secret | <https://developer.spotify.com/dashboard> → Create app → Redirect URI `http://127.0.0.1:8888/callback` |
| **Slack** | Bot Token (`xoxb-…`), App Token (`xapp-…`), Signing Secret, Channel ID | <https://api.slack.com/apps> → Create from manifest, paste `deploy/slack-app-manifest.yaml`, install to workspace, enable Socket Mode |
| **OpenRouter** | API key | <https://openrouter.ai/keys> |
| **Slack channel ID** | `C0123…` | Right-click your bot's channel in Slack → *View channel details* → bottom of the panel |

Invite `@Jam Bot` into the chosen Slack channel.

### 2. Get the Spotify refresh token (local, one time)

On your laptop:

```bash
git clone <your-fork-url>
cd <repo>/artifacts/jam-bot
pnpm install
cp .env.example .env       # fill in SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET
pnpm run spotify:auth      # opens a browser; sign in as the HOST account
```

Copy the printed `SPOTIFY_REFRESH_TOKEN` into `.env`. Fill in the Slack and OpenRouter values too.

### 3. Set up the droplet

SSH in and run:

```bash
# 3a. Install librespot + node + pnpm
sudo apt-get update && sudo apt-get install -y librespot nodejs npm
sudo npm install -g pnpm

# 3b. Service user + dirs
sudo useradd --system --create-home --home-dir /opt/jam-bot --shell /usr/sbin/nologin jam
sudo mkdir -p /opt/jam-bot /opt/jam-bot/librespot-cache
sudo chown -R jam:jam /opt/jam-bot

# 3c. Clone + build the bot
sudo mkdir -p /opt/jam-bot-repo && sudo chown jam:jam /opt/jam-bot-repo
sudo -u jam git clone <your-fork-url> /opt/jam-bot-repo
sudo ln -sfn /opt/jam-bot-repo/artifacts/jam-bot /opt/jam-bot/app
cd /opt/jam-bot/app
sudo -u jam pnpm install --prod=false
sudo -u jam pnpm run build
```

### 4. Drop in `.env` and start the services

```bash
# Copy your filled-in .env to the droplet, then:
sudo mv ~/.env /opt/jam-bot/.env
sudo chown jam:jam /opt/jam-bot/.env && sudo chmod 600 /opt/jam-bot/.env

sudo cp /opt/jam-bot/app/deploy/librespot.service /etc/systemd/system/
sudo cp /opt/jam-bot/app/deploy/jam-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now librespot.service jam-bot.service
```

### 5. Sign librespot into your account (one time)

On your phone, open Spotify (signed in as the **host Premium account**) → device picker → tap **Jam Host**. That hands librespot a credential, which it saves to `/opt/jam-bot/librespot-cache/credentials.json`. From now on it auto-signs-in across reboots.

If your phone can't see *Jam Host*, use the OAuth fallback in [`SETUP.md` § 6](./SETUP.md#option-b--explicit-oauth-if-zeroconf-doesnt-reach-the-droplet).

### 6. Start the actual Jam

In the Spotify app: tap the device picker → **Jam Host** → tap the Jam icon → **Start a Jam** → share the link with friends.

Verify in Slack:

```
/nowplaying
```

You should see a "Now playing" card. ✅

---

## Part 2 — How to use it

All commands work in the configured Slack channel. You can also just *talk* to the bot in plain English — it routes most of these via NL too.

### Slash commands

| Command | What it does |
| --- | --- |
| `/play <song or artist>` | Play that track right now (skips current). Rate-limited to **5 plays per user per hour**. |
| `/queue <song or artist>` | Add to the queue (no rate limit). |
| `/skip` | Cast a vote to skip. **3 votes** within 5 minutes triggers an actual skip. |
| `/nowplaying` | Show what's playing right now, with album art. |
| `/history` | Show the last few tracks the Jam played. |
| `/wrapped` | Post this week's Jam recap (top tracks, top artists, per-person stats, AI narration). Also auto-posts every Sunday 20:00 UTC. |
| `/dna` / `/dna @user` | Show your (or someone's) musical "taste DNA" card — top artists, signature track, discovery rate. |
| `/compat @userA @userB` | Score two people's musical compatibility 0-100 with shared artists + a track recommendation each way. |
| `/memory <question>` | Free-form recall over Jam history, e.g. "who introduced us to Khruangbin?" — or **"play me a 5-track set from last weekend"** to actually queue tracks. |
| `/jamoptout` / `/jamoptout off` | Hide your personal stats from `/wrapped`, `/dna`, `/compat` (your plays still count toward channel totals). Run `off` to undo. |

### Natural language (just type in the channel)

```
play some lo-fi study beats
queue Bohemian Rhapsody
skip                              ← counts as one vote
what's playing?
who produced this song?           ← LLM answer in a thread
have we played Mr. Brightside before?
what did we play last Friday?
how many times have we played Daft Punk?
```

### Vote-to-skip

Every "Now playing" card has a **Vote skip (X/3)** button. The card updates as votes come in; once the threshold is hit the bot calls Spotify to skip and posts a confirmation. Both `/skip` and saying "skip" in the channel count as votes — no single person can override the room.

### When something goes wrong

| Symptom | Fix |
| --- | --- |
| Bot says "No active Spotify playback" | Open Spotify on your phone → device picker → **Jam Host** → hit play. |
| `/play` says "you've hit your hourly request limit" | Wait, or have someone else queue it, or bump `MAX_PLAYS_PER_USER_PER_HOUR` in `.env` and restart. |
| Bot is silent on slash commands | `sudo journalctl -u jam-bot -n 100 -f` — usually a stale token. |
| librespot device disappeared from Spotify | `sudo systemctl restart librespot` (it'll pick up cached creds). |

For the long version, see [`SETUP.md` § Troubleshooting](./SETUP.md#troubleshooting).

---

## Part 3 — Updating the bot

```bash
cd /opt/jam-bot/app
sudo -u jam git pull
sudo -u jam pnpm install --prod=false
sudo -u jam pnpm run build
sudo systemctl restart jam-bot
```
