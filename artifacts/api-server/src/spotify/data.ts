import { db } from "@workspace/db";
import { cachedTracksTable, cachedArtistsTable, type User } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { getAuthenticatedClient } from "./client";

const CACHE_DURATION_MS = 6 * 60 * 60 * 1000;

interface TrackData {
  spotifyTrackId: string;
  trackName: string;
  artistNames: string[];
  artistIds: string[];
  albumName: string;
  albumImageUrl: string | null;
  previewUrl: string | null;
  durationMs: number;
  popularity: number;
}

interface ArtistData {
  spotifyArtistId: string;
  artistName: string;
  genres: string[];
  popularity: number;
  imageUrl: string | null;
}

async function fetchAudioFeatures(
  user: User,
  trackIds: string[]
): Promise<Map<string, { energy: number; danceability: number; tempo: number; valence: number; acousticness: number; instrumentalness: number }>> {
  const client = await getAuthenticatedClient(user);
  const featureMap = new Map();

  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100);
    try {
      const response = await client.getAudioFeaturesForTracks(batch);
      for (const f of response.body.audio_features) {
        if (f) {
          featureMap.set(f.id, {
            energy: f.energy,
            danceability: f.danceability,
            tempo: f.tempo,
            valence: f.valence,
            acousticness: f.acousticness,
            instrumentalness: f.instrumentalness,
          });
        }
      }
    } catch (e) {
      console.error("Error fetching audio features:", e);
    }
  }

  return featureMap;
}

function parseTrack(track: SpotifyApi.TrackObjectFull): TrackData {
  return {
    spotifyTrackId: track.id,
    trackName: track.name,
    artistNames: track.artists.map((a) => a.name),
    artistIds: track.artists.map((a) => a.id),
    albumName: track.album.name,
    albumImageUrl: track.album.images?.[0]?.url || null,
    previewUrl: track.preview_url || null,
    durationMs: track.duration_ms,
    popularity: track.popularity,
  };
}

export async function fetchAndCacheUserTracks(user: User): Promise<void> {
  const existing = await db
    .select()
    .from(cachedTracksTable)
    .where(eq(cachedTracksTable.userId, user.id))
    .limit(1);

  if (existing.length > 0 && Date.now() - existing[0].fetchedAt.getTime() < CACHE_DURATION_MS) {
    return;
  }

  await db.delete(cachedTracksTable).where(eq(cachedTracksTable.userId, user.id));

  const client = await getAuthenticatedClient(user);
  const allTracks: { track: TrackData; source: string }[] = [];

  const timeRanges: Array<{ range: "short_term" | "medium_term" | "long_term"; source: string }> = [
    { range: "short_term", source: "top_short" },
    { range: "medium_term", source: "top_medium" },
    { range: "long_term", source: "top_long" },
  ];

  for (const { range, source } of timeRanges) {
    try {
      const response = await client.getMyTopTracks({ time_range: range, limit: 50 });
      for (const t of response.body.items) {
        allTracks.push({ track: parseTrack(t), source });
      }
    } catch (e) {
      console.error(`Error fetching top tracks (${range}):`, e);
    }
  }

  try {
    const response = await client.getMySavedTracks({ limit: 50 });
    for (const item of response.body.items) {
      allTracks.push({ track: parseTrack(item.track), source: "saved" });
    }
  } catch (e) {
    console.error("Error fetching saved tracks:", e);
  }

  try {
    const response = await client.getMyRecentlyPlayedTracks({ limit: 50 });
    for (const item of response.body.items) {
      const t = item.track as SpotifyApi.TrackObjectFull;
      allTracks.push({
        track: {
          spotifyTrackId: t.id,
          trackName: t.name,
          artistNames: t.artists.map((a) => a.name),
          artistIds: t.artists.map((a) => a.id),
          albumName: t.album.name,
          albumImageUrl: t.album.images?.[0]?.url || null,
          previewUrl: t.preview_url || null,
          durationMs: t.duration_ms,
          popularity: t.popularity || 0,
        },
        source: "recent",
      });
    }
  } catch (e) {
    console.error("Error fetching recent tracks:", e);
  }

  const trackIds = [...new Set(allTracks.map((t) => t.track.spotifyTrackId))];
  const audioFeatures = await fetchAudioFeatures(user, trackIds);

  const now = new Date();
  const insertValues = allTracks.map(({ track, source }) => {
    const features = audioFeatures.get(track.spotifyTrackId);
    return {
      userId: user.id,
      spotifyTrackId: track.spotifyTrackId,
      trackName: track.trackName,
      artistNames: JSON.stringify(track.artistNames),
      artistIds: JSON.stringify(track.artistIds),
      albumName: track.albumName,
      albumImageUrl: track.albumImageUrl,
      previewUrl: track.previewUrl,
      durationMs: track.durationMs,
      popularity: track.popularity,
      source,
      energy: features?.energy ?? null,
      danceability: features?.danceability ?? null,
      tempo: features?.tempo ?? null,
      valence: features?.valence ?? null,
      acousticness: features?.acousticness ?? null,
      instrumentalness: features?.instrumentalness ?? null,
      fetchedAt: now,
    };
  });

  if (insertValues.length > 0) {
    for (let i = 0; i < insertValues.length; i += 500) {
      await db.insert(cachedTracksTable).values(insertValues.slice(i, i + 500));
    }
  }
}

export async function fetchAndCacheUserArtists(user: User): Promise<void> {
  const existing = await db
    .select()
    .from(cachedArtistsTable)
    .where(eq(cachedArtistsTable.userId, user.id))
    .limit(1);

  if (existing.length > 0 && Date.now() - existing[0].fetchedAt.getTime() < CACHE_DURATION_MS) {
    return;
  }

  await db.delete(cachedArtistsTable).where(eq(cachedArtistsTable.userId, user.id));

  const client = await getAuthenticatedClient(user);
  const allArtists: { artist: ArtistData; source: string }[] = [];

  const timeRanges: Array<{ range: "short_term" | "medium_term" | "long_term"; source: string }> = [
    { range: "short_term", source: "top_short" },
    { range: "medium_term", source: "top_medium" },
    { range: "long_term", source: "top_long" },
  ];

  for (const { range, source } of timeRanges) {
    try {
      const response = await client.getMyTopArtists({ time_range: range, limit: 50 });
      for (const a of response.body.items) {
        allArtists.push({
          artist: {
            spotifyArtistId: a.id,
            artistName: a.name,
            genres: a.genres,
            popularity: a.popularity,
            imageUrl: a.images?.[0]?.url || null,
          },
          source,
        });
      }
    } catch (e) {
      console.error(`Error fetching top artists (${range}):`, e);
    }
  }

  const now = new Date();
  const insertValues = allArtists.map(({ artist, source }) => ({
    userId: user.id,
    spotifyArtistId: artist.spotifyArtistId,
    artistName: artist.artistName,
    genres: JSON.stringify(artist.genres),
    popularity: artist.popularity,
    imageUrl: artist.imageUrl,
    source,
    fetchedAt: now,
  }));

  if (insertValues.length > 0) {
    for (let i = 0; i < insertValues.length; i += 500) {
      await db.insert(cachedArtistsTable).values(insertValues.slice(i, i + 500));
    }
  }
}

export async function refreshAllUsersData(users: User[]): Promise<void> {
  for (const user of users) {
    try {
      await fetchAndCacheUserTracks(user);
      await fetchAndCacheUserArtists(user);
    } catch (e) {
      console.error(`Error refreshing data for user ${user.slackUserId}:`, e);
    }
  }
}

export async function getUserTracks(userId: number, source?: string) {
  if (source) {
    return db
      .select()
      .from(cachedTracksTable)
      .where(and(eq(cachedTracksTable.userId, userId), eq(cachedTracksTable.source, source)));
  }
  return db.select().from(cachedTracksTable).where(eq(cachedTracksTable.userId, userId));
}

export async function getUserArtists(userId: number, source?: string) {
  if (source) {
    return db
      .select()
      .from(cachedArtistsTable)
      .where(and(eq(cachedArtistsTable.userId, userId), eq(cachedArtistsTable.source, source)));
  }
  return db.select().from(cachedArtistsTable).where(eq(cachedArtistsTable.userId, userId));
}
