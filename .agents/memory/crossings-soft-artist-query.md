---
name: Crossings soft-artist query bottleneck
description: Why the /me/crossings endpoint was slow and how the soft-artist subquery fixes it.
---

## The rule
Never pass a pre-fetched list of artist names as a literal SQL array to `= any(array[...])`. Use a subquery so Postgres can plan a hash-join.

## Why
A user with ~1,500 unresolved Spotify imports produces ~1,500 distinct soft artist names. The old code fetched them in application code then embedded them as a literal array:

```sql
lower(trim(recordings.artist)) = any(array['artist1', 'artist2', ... 1500 more ...]::text[])
```

Problems:
1. The serialised array literal is huge — several KB of SQL text the parser must process.
2. Postgres cannot plan a hash-join against a literal array; it compares every recording row against all 1500 values individually.
3. Total query time: 20 s+ for a user with a large unresolved import.

## How to apply
Use a `selectDistinct` subquery instead:

```ts
const userSoftArtists = db
  .selectDistinct({ artistLower: sql<string>`lower(trim(${spotifyLibraryItemsTable.artist}))` })
  .from(spotifyLibraryItemsTable)
  .where(and(eq(...userId), isNull(...mbid), ne(...artist, "")));

const artistMatch = sql`(
  ${recordingsTable.artistMbid} in (${userLibArtists})
  or lower(trim(${recordingsTable.artist})) in (${userSoftArtists})
)`;
```

Postgres builds a hash-table of soft artist names once, then probes it per recording row — effectively O(n) instead of O(n·m). The subquery also degrades cleanly (zero rows) when the table is absent or the user has no soft items, removing the need for a try/catch pre-fetch.

The fix lives in `GET /api/me/crossings` in `artifacts/api-server/src/routes/me/index.ts`.
