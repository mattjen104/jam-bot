# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains **Lore Radio** — a radio discovery app that surfaces live radio stations playing music from the listener's personal library, and **jam-bot** — a Slack bot that provides live music knowledge during listening sessions.

## Products

### Lore Radio (`artifacts/lore`)
A web app with three surfaces:
- **The Dial** — front door; ranks live stations by library overlap, attribution (selector/DJ), and taste signal. Three-zone layout: Zone 1 (with a reason), Zone 2 (ghost — stations playing library-artist tracks the listener hasn't heard there before), Zone 3 (also on air, dimmed).
- **The Library** — the listener's full track collection: MB-resolved library items + Spotify-only soft rows; filters by provenance; source for crossing detection.
- **The Archive** — station/show/selector history; run replay; selector profiles.

### jam-bot (`artifacts/api-server/src/slack/`)
Slack bot (Socket Mode) that answers music questions in a Jam session, posts timed insights at key moments in a track, and surfaces song knowledge (liner notes, relationships, Song Exploder, Wikipedia).

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API server**: Express 5 (`artifacts/api-server`)
- **Web frontend**: React + Vite (`artifacts/lore`)
- **Slack bot**: @slack/bolt (Socket Mode)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from `lib/api-spec/openapi.yaml`)
- **Now-playing**: ICY watcher (persistent TCP), SSE push, 5s REST backstop

## Structure

```text
artifacts/
├── api-server/           # Express API + Slack bot + all pollers/workers
│   └── src/
│       ├── index.ts              # Entry point
│       ├── routes/               # Express routes
│       │   ├── me/index.ts       # Library import, keep, sync, crossings, ghost (4100+ lines)
│       │   ├── lore/stations.ts  # Station/spin/schedule/now-playing endpoints
│       │   └── spotify/          # Spotify OAuth + playback
│       ├── lore/                 # Core workers and pollers
│       │   ├── icy-watcher.ts    # Persistent ICY TCP connections (watcher tier)
│       │   ├── multiplexer.ts    # Host classifier + poller routing
│       │   ├── serviceConnector.ts # Pluggable streaming-service interface (Spotify impl)
│       │   └── library-sync.ts   # Spotify sync worker
│       └── slack/                # jam-bot (Bolt)
├── lore/                 # React/Vite web frontend
│   └── src/
│       ├── components/
│       │   ├── DialView.tsx      # Front door (1500+ lines)
│       │   └── LibraryRow.tsx    # Library track row
│       ├── hooks/
│       │   └── useDialData.ts    # Dial data assembly; station crossing scores come from GET /api/me/crossings
│       ├── pages/
│       │   ├── Library.tsx       # Library page
│       │   └── Archive/          # Station/show/selector archive pages
│       └── lib/
│           └── meHooks.ts        # React Query hooks for /api/me/*
lib/
├── api-spec/             # openapi.yaml + orval config
├── api-client-react/     # Generated React Query hooks
├── api-zod/              # Generated Zod schemas
└── db/                   # Drizzle schema + DB connection
    └── src/schema/lore.ts  # Main schema (stations, spins, library, selectors, …)
```

## Environment Variables

### Spotify
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`

### Slack (jam-bot)
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`

### AI (jam-bot knowledge)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` / `AI_INTEGRATIONS_ANTHROPIC_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`

### Auto-provisioned
- `DATABASE_URL` — PostgreSQL (Replit managed)
- `SESSION_SECRET` — Express session

## Key Design Decisions

- **Library crossings drive ranking** — stations are ranked by how many of the listener's library tracks (and artists) have played there. Exact MBID match > artist match > historical 24h window.
- **reason() ladder** (DialView.tsx) — r=1..4 are "warm" (Zone 1); r=5..7 and r=0 are "dim" (Zone 3). r values are consecutive integers with no gaps or collisions.
- **Crossing computation is server-side** — `GET /api/me/crossings` runs a true `NOW() − 24h` query and returns `{ items: [{ stationSlug, crossings, artistCrossings }] }`. `useDialData.ts` consumes it via `useMyDialCrossings`; client-side reduction is no longer used for station ranking.
- **ServiceConnector interface** — streaming library import is service-agnostic; SpotifyConnector is the only current implementation. Adding Apple Music/Tidal means implementing the interface.
- **Soft library rows** — Spotify tracks that didn't resolve to MusicBrainz live in `spotify_library_items` and appear in the Library alongside resolved `library_items`.
- **ICY watchers** — favorite stations get a persistent TCP socket for instant now-playing; FAILURE_LIMIT=12 / 30min prevents boot-contention from triggering permanent fallback.
- **No client-side audio features** — compatibility is library overlap + artist overlap only; audio feature similarity was explicitly ruled out.
- **Ghost zone (Zone 2)** — shipped; surfaces stations playing tracks by library artists that the listener hasn't heard at those stations before. `GET /api/me/ghost/missed` returns up to 20 such stations; `DialView.tsx` renders them as Zone 2 rows.

## TypeScript & Build

- Every package extends `tsconfig.base.json` (`composite: true`).
- After any schema or type change in `lib/db` or `lib/api-zod`, rebuild with `tsc -p tsconfig.json` in that lib before running the consumer.
- `pnpm run typecheck` — root-level composite typecheck.
- `pnpm run build` — typecheck then recursive build.

## User Preferences

- Front-door primary sort key is lifetime overlap; live crossings are a promotion signal only.
- The "library that discovers" premise (Zone 2 / ghost zone) is the core differentiating feature; the endpoint and dial section are now live.
