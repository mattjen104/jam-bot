import { type User } from "@workspace/db/schema";
import { getAuthenticatedClient, getAllConnectedUsers } from "../spotify/client";
import { getUserTracks, getUserArtists } from "../spotify/data";

interface TrackDeepDive {
  trackName: string;
  artistNames: string[];
  albumName: string | null;
  albumImageUrl: string | null;
  releaseDate: string | null;
  popularity: number;
  durationFormatted: string;
  audioProfile: {
    energy: number;
    danceability: number;
    valence: number;
    tempo: number;
    acousticness: number;
    instrumentalness: number;
  } | null;
  energyLabel: string;
  moodLabel: string;
  artistGenres: string[];
  artistPopularity: number;
  whoHasIt: string[];
  funFacts: string[];
}

function getEnergyLabel(energy: number): string {
  if (energy > 0.8) return "Explosive";
  if (energy > 0.6) return "High energy";
  if (energy > 0.4) return "Moderate";
  if (energy > 0.2) return "Laid back";
  return "Very chill";
}

function getMoodLabel(valence: number): string {
  if (valence > 0.8) return "Euphoric";
  if (valence > 0.6) return "Upbeat";
  if (valence > 0.4) return "Balanced";
  if (valence > 0.2) return "Reflective";
  return "Dark / Melancholy";
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function generateFunFacts(
  track: SpotifyApi.TrackObjectFull,
  artist: SpotifyApi.ArtistObjectFull | null,
  audioFeatures: SpotifyApi.AudioFeaturesObject | null
): string[] {
  const facts: string[] = [];

  if (track.popularity > 80) {
    facts.push(`This track is a massive hit with a popularity score of ${track.popularity}/100`);
  } else if (track.popularity < 30) {
    facts.push(`Deep cut alert — this track has a niche popularity score of ${track.popularity}/100`);
  }

  if (audioFeatures) {
    if (audioFeatures.tempo > 150) {
      facts.push(`Fast tempo at ${Math.round(audioFeatures.tempo)} BPM — built for running or dancing`);
    } else if (audioFeatures.tempo < 80) {
      facts.push(`Slow groove at ${Math.round(audioFeatures.tempo)} BPM — perfect for winding down`);
    }

    if (audioFeatures.instrumentalness > 0.5) {
      facts.push("Mostly instrumental — lets the music do the talking");
    }

    if (audioFeatures.acousticness > 0.8) {
      facts.push("Highly acoustic — stripped back, raw sound");
    }

    if (audioFeatures.danceability > 0.8) {
      facts.push("Extremely danceable — your body can't help but move");
    }

    if (audioFeatures.energy > 0.9) {
      facts.push("Maximum energy — an absolute banger");
    }

    if (audioFeatures.valence > 0.9) {
      facts.push("One of the happiest-sounding tracks out there");
    } else if (audioFeatures.valence < 0.1) {
      facts.push("Deeply melancholic — for those introspective moments");
    }
  }

  if (artist) {
    if (artist.followers && artist.followers.total > 10_000_000) {
      facts.push(`${artist.name} has ${(artist.followers.total / 1_000_000).toFixed(1)}M followers on Spotify`);
    } else if (artist.followers && artist.followers.total < 100_000) {
      facts.push(`${artist.name} is a rising artist with ${(artist.followers.total / 1000).toFixed(0)}K followers`);
    }

    if (artist.genres && artist.genres.length > 0) {
      facts.push(`${artist.name}'s sound spans: ${artist.genres.slice(0, 4).join(", ")}`);
    }
  }

  if (track.album.total_tracks === 1) {
    facts.push("Released as a single");
  } else if (track.album.total_tracks > 15) {
    facts.push(`Part of a ${track.album.total_tracks}-track album`);
  }

  return facts.slice(0, 5);
}

export async function trackDeepDive(
  requestingUser: User,
  query: string
): Promise<TrackDeepDive | null> {
  const client = await getAuthenticatedClient(requestingUser);

  const searchResult = await client.searchTracks(query, { limit: 1 });
  const track = searchResult.body.tracks?.items[0];
  if (!track) return null;

  let audioFeatures: SpotifyApi.AudioFeaturesObject | null = null;
  try {
    const featuresResult = await client.getAudioFeaturesForTrack(track.id);
    audioFeatures = featuresResult.body;
  } catch {}

  let artist: SpotifyApi.ArtistObjectFull | null = null;
  try {
    const artistResult = await client.getArtist(track.artists[0].id);
    artist = artistResult.body;
  } catch {}

  const allUsers = await getAllConnectedUsers();
  const whoHasIt: string[] = [];
  for (const u of allUsers) {
    const tracks = await getUserTracks(u.id);
    if (tracks.some((t) => t.spotifyTrackId === track.id)) {
      whoHasIt.push(u.spotifyDisplayName || u.slackDisplayName || "Unknown");
    }
  }

  return {
    trackName: track.name,
    artistNames: track.artists.map((a) => a.name),
    albumName: track.album.name,
    albumImageUrl: track.album.images?.[0]?.url || null,
    releaseDate: track.album.release_date || null,
    popularity: track.popularity,
    durationFormatted: formatDuration(track.duration_ms),
    audioProfile: audioFeatures
      ? {
          energy: audioFeatures.energy,
          danceability: audioFeatures.danceability,
          valence: audioFeatures.valence,
          tempo: audioFeatures.tempo,
          acousticness: audioFeatures.acousticness,
          instrumentalness: audioFeatures.instrumentalness,
        }
      : null,
    energyLabel: audioFeatures ? getEnergyLabel(audioFeatures.energy) : "Unknown",
    moodLabel: audioFeatures ? getMoodLabel(audioFeatures.valence) : "Unknown",
    artistGenres: artist?.genres || [],
    artistPopularity: artist?.popularity || 0,
    whoHasIt,
    funFacts: generateFunFacts(track, artist, audioFeatures),
  };
}

interface ArtistConnection {
  artist1: string;
  artist1Id: string;
  artist1Owner: string;
  artist2: string;
  artist2Id: string;
  artist2Owner: string;
  connectionType: string;
}

export async function findArtistConnections(
  users: User[]
): Promise<ArtistConnection[]> {
  const userArtistsMap = new Map<number, Array<{ id: string; name: string; genres: string[] }>>();

  for (const user of users) {
    const artists = await getUserArtists(user.id);
    const parsed = artists.map((a) => ({
      id: a.spotifyArtistId,
      name: a.artistName,
      genres: JSON.parse(a.genres) as string[],
    }));
    userArtistsMap.set(user.id, parsed);
  }

  const connections: ArtistConnection[] = [];
  const seen = new Set<string>();

  const userPairs: Array<[User, User]> = [];
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      userPairs.push([users[i], users[j]]);
    }
  }

  for (const [u1, u2] of userPairs) {
    const artists1 = userArtistsMap.get(u1.id) || [];
    const artists2 = userArtistsMap.get(u2.id) || [];

    for (const a1 of artists1) {
      for (const a2 of artists2) {
        if (a1.id === a2.id) continue;

        const key = [a1.id, a2.id].sort().join("-");
        if (seen.has(key)) continue;

        const sharedGenres = a1.genres.filter((g) => a2.genres.includes(g));
        if (sharedGenres.length >= 2) {
          seen.add(key);
          connections.push({
            artist1: a1.name,
            artist1Id: a1.id,
            artist1Owner: u1.spotifyDisplayName || u1.slackDisplayName || "Unknown",
            artist2: a2.name,
            artist2Id: a2.id,
            artist2Owner: u2.spotifyDisplayName || u2.slackDisplayName || "Unknown",
            connectionType: `Shared genres: ${sharedGenres.slice(0, 3).join(", ")}`,
          });
        }
      }
    }
  }

  try {
    const firstUser = users[0];
    const client = await getAuthenticatedClient(firstUser);
    const allArtistIds = new Set<string>();
    for (const artists of userArtistsMap.values()) {
      for (const a of artists) {
        allArtistIds.add(a.id);
      }
    }

    const artistOwnerMap = new Map<string, string>();
    for (const user of users) {
      for (const a of userArtistsMap.get(user.id) || []) {
        if (!artistOwnerMap.has(a.id)) {
          artistOwnerMap.set(a.id, user.spotifyDisplayName || user.slackDisplayName || "Unknown");
        }
      }
    }

    const artistNameMap = new Map<string, string>();
    for (const artists of userArtistsMap.values()) {
      for (const a of artists) {
        artistNameMap.set(a.id, a.name);
      }
    }

    const sampleIds = [...allArtistIds].slice(0, 10);
    for (const artistId of sampleIds) {
      try {
        const related = await client.getArtistRelatedArtists(artistId);
        for (const rel of related.body.artists.slice(0, 10)) {
          if (allArtistIds.has(rel.id) && rel.id !== artistId) {
            const key = [artistId, rel.id].sort().join("-related-");
            if (!seen.has(key)) {
              seen.add(key);
              connections.push({
                artist1: artistNameMap.get(artistId) || "Unknown",
                artist1Id: artistId,
                artist1Owner: artistOwnerMap.get(artistId) || "Unknown",
                artist2: rel.name,
                artist2Id: rel.id,
                artist2Owner: artistOwnerMap.get(rel.id) || "Unknown",
                connectionType: "Spotify says they're related artists",
              });
            }
          }
        }
      } catch {}
    }
  } catch {}

  return connections.slice(0, 20);
}
