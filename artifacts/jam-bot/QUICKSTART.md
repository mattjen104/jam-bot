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

### Where the bot replies (notification-friendly by design)

- **She replies wherever she was addressed.** A slash command, `@Jam Bot`
  mention, or engaged-thread reply in the channel is answered in the channel;
  a DM from the host is answered in the DM. Nothing you ask in a DM ever leaks
  to the channel.
- **Ambient "Now playing" cards only post while a Jam is active.** The
  automated track-change card posts to the channel **only when the host
  Spotify account is in an active Jam** (whether the host started it or joined
  someone else's). No Jam → no cards: tracks still play and get logged to
  history, the channel just stays quiet. This needs the relay configured
  (`SPOTIFY_TOKEN_RELAY_URL` / `SPOTIFY_TOKEN_RELAY_SECRET`) so the bot can
  check Jam status; if the relay is unreachable it **fails quiet** (no cards)
  rather than spamming the channel. The Jam check is cached for
  `JAM_ACTIVE_CACHE_MS` (default 15s) so the per-track path never hammers the
  relay.
- **A guided tour follows its origin.** A tour started with `@Jam Bot give us
  a tour of …` in the channel narrates each track in the channel; a tour
  started in the host DM narrates entirely in the DM — the per-track cards and
  tidbits never reach the channel, even if a Jam is active.
- **Connect/disconnect notices** ("no active device", "Jam is back online")
  are only logged to the droplet journal, never posted.

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

### DM the host surface (private control + testing)

Set `JAM_QUIET_DM_USER` to your Slack user ID and **you can DM the bot directly** — it responds exactly as if you'd typed the message in the channel, no `@Jam Bot` prefix needed (a DM is already a 1:1 conversation). Slash commands (`/play`, `/jam`, etc.) work in the DM too. Both natural-language and slash commands trigger the same real Spotify operations (the music actually plays on the host device); the **reply lands in your DM, not the channel** — and that includes a guided tour: a tour you start in the DM narrates each track privately in the DM.

This is the recommended way to drive or test the bot without notifying anyone in the Jam channel. DMs from anyone other than `JAM_QUIET_DM_USER` are ignored.

> **Note:** `JAM_QUIET_DM_USER` is just the historical name for "the host allowed to DM the bot" — there's no separate quiet/test mode toggle anymore. The bot is quiet by default in the channel (ambient cards only post during an active Jam), so you no longer need to flip a mode to keep it from spamming.

### Starting a Spotify Jam

Spotify hasn't published a public Web API for starting a Jam (social listening) session, and even Spotify's *Web Player* isn't allowed to create one — only the desktop and mobile apps can. The bot's setup splits the work: an always-on **home Windows PC** runs Spotify Desktop, the Python relay, the Cloudflare tunnel, and a UI-automation driver. The **droplet** runs only the Slack bot and asks the home PC to click *Start a Jam* whenever someone in Slack says so.

When `/jam` (or "start a jam" via natural language) fires, the bot:

1. Asks the relay for a fresh Web Player token and checks Spotify for an already-active Jam — if there is one, posts that URL.
2. Otherwise POSTs `/jam/start` to the relay, which spawns `jam_start_windows.py` to drive Spotify Desktop (pywinauto + UIA, with an OpenRouter vision-model fallback) and returns the new join URL.
3. Posts the URL into Slack. If both paths fail, the manual instructions still appear — nothing is left half-broken.

Set `SPOTIFY_TOKEN_RELAY_URL` and `SPOTIFY_TOKEN_RELAY_SECRET` in the droplet's `.env` to point at the home PC's Cloudflare tunnel. For the full Windows host setup (Python deps, env vars, autostart on reboot, debugging) see [`tools/spotify-token-relay/HOST_SETUP_WINDOWS.md`](../../tools/spotify-token-relay/HOST_SETUP_WINDOWS.md).

`/play`, `/queue`, `/skip` keep working without a Jam — they go straight to the host device.

> **Linux migration note.** A future move of the Jam Host to an old Mac running Linux is supported by design: `jam_start_windows.py` is the only Windows-specific piece, and the relay's HTTP contract stays the same. Add a `jam_start_linux.py` (AT-SPI / xdotool, same JSON-on-stdout contract) and have the relay select it on `sys.platform != "win32"`.

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

### Sync the Jam to a record player or your computer audio (optional)

Got a turntable — or just a YouTube/Apple Music tab playing? The bot can listen
to it, identify it with ACRCloud, and drive the Jam to the streamed version so
guests hear it too. Set the `ACRCLOUD_*` and `TURNTABLE_*` values in `.env`, then
run the capture helper in [`tools/turntable-helper`](../../tools/turntable-helper/)
on the host machine and `/turntable start` in Slack:

- **Follow my record** (vinyl / line-in / mic): `DEVICE="USB Audio" npm start`.
- **Follow my computer audio** (any non-Spotify app, via OS loopback):
  `SOURCE=computer npm start` — auto-picks the loopback/monitor device. Keep the
  bot's own Spotify muted locally or on a different output so it isn't captured.

Full walkthrough: [`SETUP.md` § 8](./SETUP.md#8-turntable-sync-optional).

---

## Part 3 — Updating the bot

```bash
cd /opt/jam-bot-repo
sudo -u jam git pull
sudo -u jam pnpm install --prod=false
sudo -u jam pnpm --filter @workspace/jam-bot run build
sudo systemctl restart jam-bot
```
