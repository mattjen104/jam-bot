# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains a Slack bot ("TunePool") that helps a friend group discover shared music taste and build group Spotify playlists.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Slack bot**: @slack/bolt (Socket Mode)
- **Spotify API**: spotify-web-api-node
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## App Name

The bot is called **TunePool** — this is a placeholder. To rename, update references in:
- `artifacts/api-server/src/slack/format.ts` (APP_NAME constant)
- `artifacts/api-server/src/services/blend.ts` (playlist description)
- `artifacts/api-server/src/slack/commands/help.ts`
- `artifacts/api-server/src/slack/commands/connect.ts`
- `artifacts/api-server/src/routes/spotify-auth.ts` (callback HTML pages)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server + Slack bot
│       └── src/
│           ├── index.ts          # Entry: starts Express + Slack bot
│           ├── app.ts            # Express app setup
│           ├── routes/           # Express routes
│           │   ├── health.ts     # GET /api/healthz
│           │   └── spotify-auth.ts # GET /api/spotify/callback (OAuth)
│           ├── slack/            # Slack bot module
│           │   ├── bot.ts        # Bolt app setup, Socket Mode
│           │   ├── format.ts     # Slack Block Kit formatting helpers
│           │   └── commands/     # Slash command handlers
│           │       ├── connect.ts    # /tunepool-connect
│           │       ├── blend.ts      # /tunepool-blend, /tunepool-mood
│           │       ├── pair-blend.ts # /tunepool-pair
│           │       ├── taste-dna.ts  # /tunepool-taste
│           │       ├── deep-dive.ts  # /tunepool-dive, /tunepool-connections
│           │       ├── hidden-gems.ts # /tunepool-gems, /tunepool-whofirst
│           │       └── help.ts       # /tunepool-help
│           ├── spotify/          # Spotify API integration
│           │   ├── auth.ts       # OAuth flow + state management
│           │   ├── client.ts     # Per-user authenticated client + token refresh
│           │   └── data.ts       # Fetch & cache user tracks/artists
│           └── services/         # Core business logic
│               ├── blend.ts      # Group blend, mood mixer, pair blend, playlist creation
│               ├── discovery.ts  # Hidden gems, who brought it first
│               ├── taste-analysis.ts # Taste DNA, group comparison
│               └── artist-intel.ts   # Track deep dive, artist connections
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
│       └── src/schema/
│           ├── users.ts          # Slack/Spotify user accounts + tokens
│           ├── cached-tracks.ts  # Cached Spotify tracks with audio features
│           └── cached-artists.ts # Cached Spotify artists with genres
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Environment Variables Required

### Slack (from api.slack.com/apps)
- `SLACK_BOT_TOKEN` — Bot User OAuth Token (xoxb-...)
- `SLACK_SIGNING_SECRET` — App signing secret
- `SLACK_APP_TOKEN` — App-Level Token for Socket Mode (xapp-...)

### Spotify (from developer.spotify.com/dashboard)
- `SPOTIFY_CLIENT_ID` — Spotify app Client ID
- `SPOTIFY_CLIENT_SECRET` — Spotify app Client Secret
- **Redirect URI**: `https://<your-domain>/api/spotify/callback` (add to Spotify app settings)

### Auto-provisioned
- `DATABASE_URL` — PostgreSQL connection string (Replit)

## Slack Commands

| Command | Description |
|---|---|
| `/tunepool-connect` | Connect your Spotify account |
| `/tunepool-blend` | Group blend playlist from everyone's taste |
| `/tunepool-mood <mood>` | Mood-filtered mix (chill, hype, melancholy, driving, feel_good, focus, party) |
| `/tunepool-pair @user` | Taste compatibility & blend with someone |
| `/tunepool-taste` | Your personal taste DNA |
| `/tunepool-taste group` | Compare everyone's taste side by side |
| `/tunepool-dive <song>` | Deep dive on any track |
| `/tunepool-connections` | Map artist connections across the group |
| `/tunepool-gems` | Hidden gems from each person's library |
| `/tunepool-whofirst` | Who discovered shared tracks first? |
| `/tunepool-help` | Show all commands |

## Slack App Setup

1. Create app at api.slack.com/apps
2. Enable Socket Mode → get App-Level Token (xapp-...)
3. Add slash commands: `/tunepool-connect`, `/tunepool-blend`, `/tunepool-mood`, `/tunepool-pair`, `/tunepool-taste`, `/tunepool-dive`, `/tunepool-connections`, `/tunepool-gems`, `/tunepool-whofirst`, `/tunepool-help`
4. OAuth scopes: `chat:write`, `commands`, `im:history`, `im:read`, `im:write`, `users:read`
5. Subscribe to bot events: `message.im`
6. Install to workspace → get Bot Token (xoxb-...)

## Database Schema

- **users** — Slack user ID, Spotify tokens (with auto-refresh), display names
- **cached_tracks** — User's Spotify tracks with audio features (energy, danceability, tempo, valence, acousticness, instrumentalness), cached for 6 hours
- **cached_artists** — User's top artists with genres, cached for 6 hours

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — only `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Key Design Decisions

- **Socket Mode** for Slack — no need for public webhook URLs, simpler development
- **Per-user Spotify OAuth** — each friend connects their own account, tokens stored in PostgreSQL with automatic refresh
- **Audio features** used for smart matching — energy, danceability, valence, tempo drive the blend algorithm
- **6-hour cache** on Spotify data to minimize API calls while staying reasonably fresh
- **Mood profiles** define audio feature ranges for each mood (chill, hype, melancholy, etc.)
- **Compatibility scores** use a weighted mix of track overlap (30%), artist overlap (30%), and audio feature similarity (40%)
