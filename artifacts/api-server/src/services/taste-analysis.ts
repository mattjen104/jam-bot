import { type User, type CachedTrack, type CachedArtist } from "@workspace/db/schema";
import { getUserTracks, getUserArtists } from "../spotify/data";

interface TasteDNA {
  userName: string;
  avgEnergy: number;
  avgDanceability: number;
  avgValence: number;
  avgTempo: number;
  avgAcousticness: number;
  topGenres: string[];
  eclecticScore: number;
  totalTracks: number;
  totalArtists: number;
  vibeLabel: string;
}

function getVibeLabel(energy: number, valence: number, danceability: number): string {
  if (energy > 0.7 && valence > 0.6 && danceability > 0.7) return "Party Animal";
  if (energy > 0.7 && valence > 0.5) return "Hype Machine";
  if (energy > 0.6 && danceability > 0.6) return "Groove Rider";
  if (energy < 0.4 && valence < 0.4) return "Melancholy Connoisseur";
  if (energy < 0.4 && valence > 0.5) return "Chill Vibes";
  if (energy < 0.5 && danceability < 0.4) return "Deep Listener";
  if (valence > 0.7) return "Sunshine DJ";
  if (valence < 0.3) return "Dark Horse";
  if (danceability > 0.7) return "Dance Floor Regular";
  return "Genre Wanderer";
}

function computeEclecticScore(genres: string[]): number {
  const unique = new Set(genres);
  return Math.min(unique.size / 15, 1);
}

export async function buildTasteDNA(user: User): Promise<TasteDNA> {
  const tracks = await getUserTracks(user.id);
  const artists = await getUserArtists(user.id);

  const withFeatures = tracks.filter((t) => t.energy !== null);

  const avgEnergy = withFeatures.length > 0
    ? withFeatures.reduce((s, t) => s + (t.energy || 0), 0) / withFeatures.length
    : 0.5;
  const avgDanceability = withFeatures.length > 0
    ? withFeatures.reduce((s, t) => s + (t.danceability || 0), 0) / withFeatures.length
    : 0.5;
  const avgValence = withFeatures.length > 0
    ? withFeatures.reduce((s, t) => s + (t.valence || 0), 0) / withFeatures.length
    : 0.5;
  const avgTempo = withFeatures.length > 0
    ? withFeatures.reduce((s, t) => s + (t.tempo || 0), 0) / withFeatures.length
    : 120;
  const avgAcousticness = withFeatures.length > 0
    ? withFeatures.reduce((s, t) => s + (t.acousticness || 0), 0) / withFeatures.length
    : 0.5;

  const allGenres = artists.flatMap((a) => {
    try {
      return JSON.parse(a.genres) as string[];
    } catch {
      return [];
    }
  });

  const genreCounts = new Map<string, number>();
  for (const g of allGenres) {
    genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);

  const uniqueArtists = new Set(artists.map((a) => a.spotifyArtistId));
  const uniqueTracks = new Set(tracks.map((t) => t.spotifyTrackId));

  return {
    userName: user.spotifyDisplayName || user.slackDisplayName || "Unknown",
    avgEnergy,
    avgDanceability,
    avgValence,
    avgTempo: Math.round(avgTempo),
    avgAcousticness,
    topGenres,
    eclecticScore: computeEclecticScore(allGenres),
    totalTracks: uniqueTracks.size,
    totalArtists: uniqueArtists.size,
    vibeLabel: getVibeLabel(avgEnergy, avgValence, avgDanceability),
  };
}

export async function buildGroupTasteComparison(
  users: User[]
): Promise<{ profiles: TasteDNA[]; groupInsights: string[] }> {
  const profiles: TasteDNA[] = [];

  for (const user of users) {
    profiles.push(await buildTasteDNA(user));
  }

  const insights: string[] = [];

  const mostEclectic = profiles.reduce((a, b) => (a.eclecticScore > b.eclecticScore ? a : b));
  insights.push(`Most eclectic listener: ${mostEclectic.userName} (${Math.round(mostEclectic.eclecticScore * 100)}% genre diversity)`);

  const mostEnergetic = profiles.reduce((a, b) => (a.avgEnergy > b.avgEnergy ? a : b));
  insights.push(`Highest energy: ${mostEnergetic.userName} (${Math.round(mostEnergetic.avgEnergy * 100)}%)`);

  const mostDancey = profiles.reduce((a, b) => (a.avgDanceability > b.avgDanceability ? a : b));
  insights.push(`Most danceable taste: ${mostDancey.userName} (${Math.round(mostDancey.avgDanceability * 100)}%)`);

  const allGenres = profiles.flatMap((p) => p.topGenres);
  const genreCounts = new Map<string, number>();
  for (const g of allGenres) {
    genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
  }
  const sharedGenres = [...genreCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  if (sharedGenres.length > 0) {
    insights.push(`Shared genres across the group: ${sharedGenres.slice(0, 5).join(", ")}`);
  }

  return { profiles, groupInsights: insights };
}
