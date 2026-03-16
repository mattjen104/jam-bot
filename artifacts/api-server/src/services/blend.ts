import { type User, type CachedTrack } from "@workspace/db/schema";
import { getUserTracks } from "../spotify/data";
import { getAuthenticatedClient } from "../spotify/client";

interface BlendTrack {
  spotifyTrackId: string;
  trackName: string;
  artistNames: string[];
  albumName: string | null;
  albumImageUrl: string | null;
  energy: number | null;
  danceability: number | null;
  tempo: number | null;
  valence: number | null;
  sharedBy: string[];
  score: number;
}

function computeGroupVibeCenter(allTracks: CachedTrack[]): {
  energy: number;
  danceability: number;
  valence: number;
  tempo: number;
} {
  const withFeatures = allTracks.filter((t) => t.energy !== null);
  if (withFeatures.length === 0) {
    return { energy: 0.5, danceability: 0.5, valence: 0.5, tempo: 120 };
  }

  return {
    energy: withFeatures.reduce((s, t) => s + (t.energy || 0), 0) / withFeatures.length,
    danceability: withFeatures.reduce((s, t) => s + (t.danceability || 0), 0) / withFeatures.length,
    valence: withFeatures.reduce((s, t) => s + (t.valence || 0), 0) / withFeatures.length,
    tempo: withFeatures.reduce((s, t) => s + (t.tempo || 0), 0) / withFeatures.length,
  };
}

function distanceToVibe(
  track: CachedTrack,
  vibe: { energy: number; danceability: number; valence: number; tempo: number }
): number {
  if (track.energy === null) return 1;
  const de = (track.energy! - vibe.energy) ** 2;
  const dd = (track.danceability! - vibe.danceability) ** 2;
  const dv = (track.valence! - vibe.valence) ** 2;
  const dt = ((track.tempo! - vibe.tempo) / 200) ** 2;
  return Math.sqrt(de + dd + dv + dt);
}

export async function buildGroupBlend(
  users: User[],
  maxTracks: number = 25
): Promise<BlendTrack[]> {
  const userTracksMap = new Map<number, CachedTrack[]>();
  const allTracks: CachedTrack[] = [];

  for (const user of users) {
    const tracks = await getUserTracks(user.id);
    userTracksMap.set(user.id, tracks);
    allTracks.push(...tracks);
  }

  const vibeCenter = computeGroupVibeCenter(allTracks);

  const trackMap = new Map<string, BlendTrack>();
  const trackOwners = new Map<string, Set<string>>();

  for (const user of users) {
    const tracks = userTracksMap.get(user.id) || [];
    for (const track of tracks) {
      if (!trackOwners.has(track.spotifyTrackId)) {
        trackOwners.set(track.spotifyTrackId, new Set());
      }
      trackOwners.get(track.spotifyTrackId)!.add(user.spotifyDisplayName || user.slackDisplayName || "Unknown");

      if (!trackMap.has(track.spotifyTrackId)) {
        trackMap.set(track.spotifyTrackId, {
          spotifyTrackId: track.spotifyTrackId,
          trackName: track.trackName,
          artistNames: JSON.parse(track.artistNames),
          albumName: track.albumName,
          albumImageUrl: track.albumImageUrl,
          energy: track.energy,
          danceability: track.danceability,
          tempo: track.tempo,
          valence: track.valence,
          sharedBy: [],
          score: 0,
        });
      }
    }
  }

  for (const [trackId, bt] of trackMap) {
    const owners = trackOwners.get(trackId)!;
    bt.sharedBy = [...owners];

    const sharedBonus = owners.size / users.length;
    const representativeTrack = allTracks.find((t) => t.spotifyTrackId === trackId)!;
    const vibeDistance = distanceToVibe(representativeTrack, vibeCenter);
    const vibeScore = 1 - Math.min(vibeDistance, 1);

    bt.score = sharedBonus * 0.6 + vibeScore * 0.4;
  }

  return [...trackMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxTracks);
}

const MOOD_PROFILES: Record<string, { energy: [number, number]; valence: [number, number]; danceability: [number, number]; tempo: [number, number] }> = {
  chill: { energy: [0, 0.4], valence: [0.3, 0.7], danceability: [0.2, 0.6], tempo: [60, 110] },
  hype: { energy: [0.7, 1], valence: [0.5, 1], danceability: [0.7, 1], tempo: [110, 180] },
  melancholy: { energy: [0, 0.4], valence: [0, 0.35], danceability: [0.1, 0.5], tempo: [50, 120] },
  driving: { energy: [0.6, 1], valence: [0.3, 0.8], danceability: [0.4, 0.8], tempo: [100, 160] },
  feel_good: { energy: [0.5, 0.9], valence: [0.6, 1], danceability: [0.5, 0.9], tempo: [90, 140] },
  focus: { energy: [0.1, 0.5], valence: [0.2, 0.6], danceability: [0.1, 0.5], tempo: [70, 130] },
  party: { energy: [0.7, 1], valence: [0.6, 1], danceability: [0.8, 1], tempo: [110, 160] },
};

function matchesMood(track: CachedTrack, mood: string): boolean {
  const profile = MOOD_PROFILES[mood];
  if (!profile || track.energy === null) return false;

  return (
    track.energy! >= profile.energy[0] &&
    track.energy! <= profile.energy[1] &&
    track.valence! >= profile.valence[0] &&
    track.valence! <= profile.valence[1] &&
    track.danceability! >= profile.danceability[0] &&
    track.danceability! <= profile.danceability[1] &&
    track.tempo! >= profile.tempo[0] &&
    track.tempo! <= profile.tempo[1]
  );
}

export function getAvailableMoods(): string[] {
  return Object.keys(MOOD_PROFILES);
}

export async function buildMoodMix(
  users: User[],
  mood: string,
  maxTracks: number = 25
): Promise<BlendTrack[]> {
  const trackMap = new Map<string, BlendTrack>();
  const trackOwners = new Map<string, Set<string>>();

  for (const user of users) {
    const tracks = await getUserTracks(user.id);
    for (const track of tracks) {
      if (!matchesMood(track, mood)) continue;

      if (!trackOwners.has(track.spotifyTrackId)) {
        trackOwners.set(track.spotifyTrackId, new Set());
      }
      trackOwners.get(track.spotifyTrackId)!.add(user.spotifyDisplayName || user.slackDisplayName || "Unknown");

      if (!trackMap.has(track.spotifyTrackId)) {
        trackMap.set(track.spotifyTrackId, {
          spotifyTrackId: track.spotifyTrackId,
          trackName: track.trackName,
          artistNames: JSON.parse(track.artistNames),
          albumName: track.albumName,
          albumImageUrl: track.albumImageUrl,
          energy: track.energy,
          danceability: track.danceability,
          tempo: track.tempo,
          valence: track.valence,
          sharedBy: [],
          score: 0,
        });
      }
    }
  }

  for (const [trackId, bt] of trackMap) {
    const owners = trackOwners.get(trackId)!;
    bt.sharedBy = [...owners];
    bt.score = owners.size / users.length + (bt.energy || 0) * 0.1;
  }

  const dedupedTracks = [...trackMap.values()];
  dedupedTracks.sort((a, b) => b.score - a.score);
  return dedupedTracks.slice(0, maxTracks);
}

export async function buildPairBlend(
  user1: User,
  user2: User,
  maxTracks: number = 20
): Promise<{ tracks: BlendTrack[]; compatibility: number; insights: string[] }> {
  const tracks1 = await getUserTracks(user1.id);
  const tracks2 = await getUserTracks(user2.id);

  const set1 = new Set(tracks1.map((t) => t.spotifyTrackId));
  const set2 = new Set(tracks2.map((t) => t.spotifyTrackId));

  const sharedTrackIds = new Set([...set1].filter((id) => set2.has(id)));

  const artistSet1 = new Set(tracks1.flatMap((t) => JSON.parse(t.artistIds) as string[]));
  const artistSet2 = new Set(tracks2.flatMap((t) => JSON.parse(t.artistIds) as string[]));
  const sharedArtists = [...artistSet1].filter((id) => artistSet2.has(id));

  const avg1 = computeGroupVibeCenter(tracks1);
  const avg2 = computeGroupVibeCenter(tracks2);

  const energyDiff = Math.abs(avg1.energy - avg2.energy);
  const danceDiff = Math.abs(avg1.danceability - avg2.danceability);
  const valenceDiff = Math.abs(avg1.valence - avg2.valence);
  const tempoDiff = Math.abs(avg1.tempo - avg2.tempo) / 200;

  const featureCompatibility = 1 - (energyDiff + danceDiff + valenceDiff + tempoDiff) / 4;
  const trackOverlap = sharedTrackIds.size / Math.min(set1.size, set2.size);
  const artistOverlap = sharedArtists.length / Math.min(artistSet1.size, artistSet2.size);

  const compatibility = Math.round(
    (featureCompatibility * 0.4 + trackOverlap * 0.3 + artistOverlap * 0.3) * 100
  );

  const insights: string[] = [];
  if (sharedTrackIds.size > 0) {
    insights.push(`You share ${sharedTrackIds.size} tracks in your libraries`);
  }
  if (sharedArtists.length > 0) {
    insights.push(`You both listen to ${sharedArtists.length} of the same artists`);
  }
  if (energyDiff < 0.15) {
    insights.push("You match on energy levels — similar intensity preference");
  } else if (energyDiff > 0.4) {
    insights.push(`You differ on energy — one of you likes it ${avg1.energy > avg2.energy ? "high" : "low"}, the other ${avg1.energy > avg2.energy ? "low" : "high"}`);
  }
  if (valenceDiff < 0.15) {
    insights.push("You both gravitate toward a similar mood");
  }

  const allTracksMap = new Map<string, CachedTrack>();
  for (const t of [...tracks1, ...tracks2]) {
    allTracksMap.set(t.spotifyTrackId, t);
  }

  const midpoint = {
    energy: (avg1.energy + avg2.energy) / 2,
    danceability: (avg1.danceability + avg2.danceability) / 2,
    valence: (avg1.valence + avg2.valence) / 2,
    tempo: (avg1.tempo + avg2.tempo) / 2,
  };

  const candidates: BlendTrack[] = [];
  const seen = new Set<string>();

  for (const t of allTracksMap.values()) {
    if (seen.has(t.spotifyTrackId)) continue;
    seen.add(t.spotifyTrackId);

    const dist = distanceToVibe(t, midpoint);
    const isShared = sharedTrackIds.has(t.spotifyTrackId);

    candidates.push({
      spotifyTrackId: t.spotifyTrackId,
      trackName: t.trackName,
      artistNames: JSON.parse(t.artistNames),
      albumName: t.albumName,
      albumImageUrl: t.albumImageUrl,
      energy: t.energy,
      danceability: t.danceability,
      tempo: t.tempo,
      valence: t.valence,
      sharedBy: isShared
        ? [user1.spotifyDisplayName || "User 1", user2.spotifyDisplayName || "User 2"]
        : [set1.has(t.spotifyTrackId) ? (user1.spotifyDisplayName || "User 1") : (user2.spotifyDisplayName || "User 2")],
      score: (isShared ? 0.5 : 0) + (1 - Math.min(dist, 1)) * 0.5,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    tracks: candidates.slice(0, maxTracks),
    compatibility,
    insights,
  };
}

export async function createSpotifyPlaylist(
  user: User,
  name: string,
  trackIds: string[],
  collaborative: boolean = false
): Promise<{ playlistUrl: string; playlistId: string }> {
  const client = await getAuthenticatedClient(user);

  const playlist = await client.createPlaylist(name, {
    description: `Created by TunePool — a group music discovery bot`,
    public: !collaborative,
    collaborative,
  });

  const uris = trackIds.map((id) => `spotify:track:${id}`);
  for (let i = 0; i < uris.length; i += 100) {
    await client.addTracksToPlaylist(playlist.body.id, uris.slice(i, i + 100));
  }

  return {
    playlistUrl: playlist.body.external_urls.spotify,
    playlistId: playlist.body.id,
  };
}
