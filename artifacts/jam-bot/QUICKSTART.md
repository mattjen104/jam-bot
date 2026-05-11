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
# 3a. Install node + pnpm + ALSA + a fake sound card.
# DO NOT use `apt install librespot` — the apt version is 0.6.x and 404s on
# every track. Build from source (dev branch >= 0.8) below.
sudo apt-get update
sudo apt-get install -y nodejs npm \
  build-essential pkg-config libssl-dev libasound2-dev alsa-utils \
  linux-modules-extra-$(uname -r)
sudo npm install -g pnpm

# Fake sound card so librespot's alsa backend has a device to write into.
# (The droplet has no real audio hardware. Jam listeners stream from Spotify
# directly to their phones, so the droplet just needs a sink to discard audio.)
sudo modprobe snd-dummy
echo "snd-dummy" | sudo tee /etc/modules-load.d/snd-dummy.conf

# Rust toolchain on the volume (root disk is too small for the build).
# Replace /mnt/your-volume with your actual volume mount path; if you have no
# extra volume, use /opt/build instead and skip the volume bits.
export RUSTUP_HOME=/mnt/your-volume/build/rustup
export CARGO_HOME=/mnt/your-volume/build/cargo
export CARGO_TARGET_DIR=/mnt/your-volume/build/cargo-target
export PATH=$CARGO_HOME/bin:$PATH
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path

# Build librespot 0.8 dev (~10-15 min on a 1-vCPU droplet — don't Ctrl+C).
cargo install --git https://github.com/librespot-org/librespot \
  --branch dev \
  --no-default-features \
  --features "alsa-backend with-libmdns native-tls" \
  --root /mnt/your-volume/build/librespot-install \
  --force
sudo cp /mnt/your-volume/build/librespot-install/bin/librespot /usr/bin/librespot

# 3b. Service user + dirs. jam MUST be in the audio group so it can open the
# /dev/snd/* device nodes (which are owned by root:audio).
sudo useradd --system --create-home --home-dir /opt/jam-bot --shell /usr/sbin/nologin jam
sudo usermod -aG audio jam
sudo mkdir -p /opt/jam-bot /opt/jam-bot/librespot-cache
sudo chown -R jam:jam /opt/jam-bot

# 3c. Clone + build the bot
sudo mkdir -p /opt/jam-bot-repo && sudo chown jam:jam /opt/jam-bot-repo
sudo -u jam git clone <your-fork-url> /opt/jam-bot-repo
sudo ln -sfn /opt/jam-bot-repo/artifacts/jam-bot /opt/jam-bot/app
cd /opt/jam-bot-repo
sudo -u jam pnpm install --prod=false
sudo -u jam pnpm --filter @workspace/jam-bot run build
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
| `/jam` | Start a Spotify Jam (social listening session). Tries the unofficial Spotify endpoint when `SPOTIFY_SP_DC` is set; otherwise prints clear "tap Start a Jam in your Spotify app on `Jam Host`" instructions, which always work. |
| `/jamoptout` / `/jamoptout off` | Hide your personal stats from `/wrapped`, `/dna`, `/compat` (your plays still count toward channel totals). Run `off` to undo. |
| `/quiet` / `/quiet on` / `/quiet off` / `/quiet status` | **Test mode.** Reroutes only the *automated background posts* — now-playing cards, "no active device", "Jam is back online", and the scheduled Wrapped — to a DM to `JAM_QUIET_DM_USER`. **Friend interactions (slash commands, @mentions, vote-skip) post in the channel normally**, so people in the Jam still get the responses they asked for. Resets to off when the bot restarts. |

### Notification-friendly defaults

- **Now-playing cards only post on Fridays** by default. Tracks still play and get logged to history every day — but the channel only sees the "Now playing" card on Friday so friends aren't notified on every track change. Override with `JAM_NOWPLAYING_DAYS` (UTC, comma-separated 0=Sun..6=Sat). Set to `0,1,2,3,4,5,6` to restore the every-day behavior.
- **Quiet mode → DMs the background posts to you.** Set `JAM_QUIET_DM_USER=U01YourSlackId` and run `/quiet on` while testing. The now-playing cards and connect/disconnect notices DM you instead of posting in the channel; friends interacting with the bot still get their normal channel responses. In quiet mode the day-of-week gate is bypassed, so you see every track-change card in your DMs regardless of day.
- **`@Jam Bot`, slash commands, and vote-skip outcomes always post in-channel** — those are direct interactions, never background noise.

### Natural language (must @-mention the bot)

To avoid the bot interpreting every message in the channel — and answering questions you were asking each other — natural language only fires when you **@-mention `@Jam Bot`** in the message. Examples:

```
@Jam Bot play some lo-fi study beats
@Jam Bot queue Bohemian Rhapsody
@Jam Bot skip                              ← counts as one vote
@Jam Bot what's playing?
@Jam Bot who produced this song?           ← LLM answer in a thread
@Jam Bot have we played Mr. Brightside before?
@Jam Bot what did we play last Friday?
@Jam Bot how many times have we played Daft Punk?
```

Slash commands (`/play`, `/skip`, etc.) don't need a mention — they're already directed at the bot.

### DM testing (host only)

If you set `JAM_QUIET_DM_USER` to your Slack user ID, **you can DM the bot directly** and it will respond exactly as if you'd typed the message in the channel — no `@Jam Bot` prefix needed in a DM, since it's already a 1:1 conversation. Slash commands (`/play`, `/jam`, etc.) also work in the DM. Both natural-language and slash commands trigger the same real Spotify operations (the music actually plays on the host device); only the Slack reply lands in your DM instead of the channel.

This is the recommended way to freely test new behavior without notifying anyone in the Jam channel. DMs from anyone other than `JAM_QUIET_DM_USER` are ignored.

### Starting a Spotify Jam

Spotify hasn't published a public Web API for starting a Jam (social listening) session, so by default `/jam` (or "start a jam" via natural language) prints clear instructions: open Spotify on your phone, tap the Connect speaker icon → `Jam Host`, then tap Connect again → **Start a Jam** → share the link.

If you want it to *actually* start the Jam programmatically, paste the `sp_dc` browser cookie from open.spotify.com into `SPOTIFY_SP_DC` in the bot's `.env` and restart. The bot will then call Spotify's undocumented social-connect endpoint and post the join URL straight to Slack. The endpoint is not officially supported and may break — when it fails, the manual instructions still appear, so nothing is left half-broken. Refresh the cookie when the programmatic path stops working.

Either way, `/play`, `/queue`, `/skip` keep working without a Jam — they go straight to the host device.

### Vote-to-skip

Every "Now playing" card has a **Vote skip (X/3)** button. The card updates as votes come in; once the threshold is hit the bot calls Spotify to skip and posts a confirmation. Both `/skip` and `@Jam Bot skip` count as votes — no single person can override the room.

### When something goes wrong

| Symptom | Fix |
| --- | --- |
| Bot says "No active Spotify playback" | Open Spotify on your phone → device picker → **Jam Host** → hit play. |
| `/play` says "you've hit your hourly request limit" | Wait, or have someone else queue it, or bump `MAX_PLAYS_PER_USER_PER_HOUR` in `.env` and restart. |
| Bot is silent on slash commands | `sudo journalctl -u jam-bot -n 100 -f` — usually a stale token. |
| librespot device disappeared from Spotify | `sudo systemctl restart librespot` (it'll pick up cached creds). |
| librespot logs `Track should be available, but no alternatives found` (404 on every track) | You're on librespot 0.6.x. Rebuild from the `dev` branch — see § 3a. |
| librespot logs `ALSA function 'snd_pcm_open' failed` / `Cannot get card index` | snd-dummy module not loaded, or the `jam` user isn't in the `audio` group. Fix: `sudo modprobe snd-dummy && sudo usermod -aG audio jam && sudo systemctl restart librespot`. |

For the long version, see [`SETUP.md` § Troubleshooting](./SETUP.md#troubleshooting).

---

## Part 3 — Updating the bot

```bash
cd /opt/jam-bot-repo
sudo -u jam git pull
sudo -u jam pnpm install --prod=false
sudo -u jam pnpm --filter @workspace/jam-bot run build
sudo systemctl restart jam-bot
```
