# Jam Bot

A self-hosted Slack bot that runs a permanent Spotify Jam from a single Linux box (designed for a DigitalOcean droplet). Friends in a Slack channel control the music with slash commands or natural messages, the bot announces what's playing, and an OpenRouter-backed LLM can answer music questions grounded in the currently playing track and recent Jam history.

## What it does

- The Jam Host runs on an always-on home Windows PC (Spotify Desktop + a small Python relay + a Cloudflare tunnel + a UI-automation driver). The droplet runs the Slack bot only and asks the home PC to click *Start a Jam* whenever someone in Slack says so. See [`tools/spotify-token-relay/HOST_SETUP_WINDOWS.md`](../../tools/spotify-token-relay/HOST_SETUP_WINDOWS.md). The legacy librespot-on-droplet path still exists as a manual fallback Connect device.
- Listens in one Slack channel:
  - Slash commands: `/play <query>`, `/queue <query>`, `/skip`, `/nowplaying`, `/history`
  - Natural messages: "play some lo-fi", "queue Bohemian Rhapsody", "skip", "what's playing", "who produced this", "recommend something similar"
- Posts a "Now playing" Block Kit card (with album art) every time the track changes, tagging the requester when known.
- Persists every played track in SQLite so the LLM can answer "what did we play last Friday" or "have we played this before".
- Auto-refreshes the Spotify access token, retries transient API errors with backoff, reconnects the Slack socket on drop, and posts a clear message in-channel when the host device goes offline.

## Out of scope

- Streaming audio out of the droplet — Jam handles per-listener playback on each user's own device.
- Web UI — control is entirely through Slack.
- Multi-workspace or multi-tenant support — one Slack workspace, one Spotify host account.

## Quick start

See [QUICKSTART.md](./QUICKSTART.md) for the 15-minute path from zero to running, plus a cheat sheet of all the commands. For the long version, options, and troubleshooting, see [SETUP.md](./SETUP.md).

## Project layout

```text
artifacts/jam-bot/
├── src/
│   ├── index.ts              # Entry point: starts Slack bot + now-playing watcher
│   ├── config.ts             # Zod-validated env config
│   ├── logger.ts             # Tiny leveled logger (journald-friendly)
│   ├── db.ts                 # SQLite (better-sqlite3) — played history + pending requests
│   ├── now-playing.ts        # Polls Spotify, persists tracks, emits trackChange events
│   ├── spotify/
│   │   ├── client.ts         # Wrapper over spotify-web-api-node + token refresh + retries
│   │   └── auth-cli.ts       # One-time OAuth handshake CLI (pnpm run spotify:auth)
│   ├── slack/
│   │   ├── bot.ts            # Bolt app: slash commands + message listener + watcher hooks
│   │   └── format.ts         # Block Kit formatters
│   └── llm/
│       └── openrouter.ts     # Intent classifier + grounded chat call
├── deploy/
│   ├── jam-bot.service       # systemd unit for the bot
│   ├── librespot.service     # systemd unit for librespot
│   └── slack-app-manifest.yaml # Drop-in Slack app manifest
├── .env.example
├── SETUP.md
├── package.json
└── tsconfig.json
```

## Configurable bits

| Env var                | Default                          | Purpose                                                    |
| ---------------------- | -------------------------------- | ---------------------------------------------------------- |
| `SPOTIFY_DEVICE_NAME`  | `Jam Host`                       | Must match `--name` on librespot                           |
| `OPENROUTER_MODEL`     | `anthropic/claude-3.5-sonnet`    | Any OpenRouter model slug                                  |
| `NOW_PLAYING_POLL_MS`  | `5000`                           | How often to poll Spotify currently-playing                |
| `LLM_HISTORY_WINDOW`   | `25`                             | Recent tracks given to the LLM as grounding context        |
| `DATABASE_PATH`        | `./data/jam.db`                  | SQLite file location                                       |
| `LOG_LEVEL`            | `info`                           | `debug` / `info` / `warn` / `error`                        |

## Resilience

- Spotify access tokens are refreshed automatically; 401s trigger an immediate refresh and retry.
- 429s honor the `Retry-After` header; 5xxs back off and retry up to 3 times.
- The Slack Bolt socket reconnects automatically.
- `systemd` restarts the bot on failure with a 5s backoff. librespot is set up the same way; if it dies the bot will see "no active device" and post a friendly nudge into Slack.

## License

MIT — do whatever you want with it.
