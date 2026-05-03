import {
  userArtistVector,
  userTrackSet,
  userTotalPlays,
  userDiscoveryCount,
  recommendFromTo,
  type TopArtistRow,
  type TopTrackRow,
} from "./db.js";

export interface DnaStats {
  slackUser: string;
  totalPlays: number;
  topArtists: TopArtistRow[];
  signatureTrackId: string | null;
  signatureTrackPlays: number;
  discoveryCount: number;
  discoveryRate: number; // 0-1
}

export function buildDnaStats(slackUser: string): DnaStats {
  const total = userTotalPlays(slackUser);
  const artists = userArtistVector(slackUser).sort((a, b) => b.plays - a.plays);
  const tracks = userTrackSet(slackUser).sort((a, b) => b.plays - a.plays);
  const firsts = userDiscoveryCount(slackUser);
  return {
    slackUser,
    totalPlays: total,
    topArtists: artists.slice(0, 5),
    signatureTrackId: tracks[0]?.track_id ?? null,
    signatureTrackPlays: tracks[0]?.plays ?? 0,
    discoveryCount: firsts,
    discoveryRate: total > 0 ? firsts / total : 0,
  };
}

export interface CompatStats {
  userA: string;
  userB: string;
  // 0-100 — Jaccard on artists (heavier weight) blended with Jaccard on tracks.
  score: number;
  sharedArtists: string[];
  sharedTracks: number;
  totalA: number;
  totalB: number;
  recommendForA: TopTrackRow[];
  recommendForB: TopTrackRow[];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) if (b.has(v)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function buildCompatStats(userA: string, userB: string): CompatStats {
  const artistsA = new Set(userArtistVector(userA).map((r) => r.artist));
  const artistsB = new Set(userArtistVector(userB).map((r) => r.artist));
  const tracksA = new Set(userTrackSet(userA).map((r) => r.track_id));
  const tracksB = new Set(userTrackSet(userB).map((r) => r.track_id));

  const artistJ = jaccard(artistsA, artistsB);
  const trackJ = jaccard(tracksA, tracksB);
  // Weight artist overlap more — exact-track overlap is a much rarer signal in
  // a small group, so it spikes the score when it does happen but doesn't
  // dominate when (as is common) two people have very different songs by the
  // same artists.
  const blended = 0.7 * artistJ + 0.3 * trackJ;
  const score = Math.round(blended * 100);

  const sharedArtists: string[] = [];
  for (const a of artistsA) if (artistsB.has(a)) sharedArtists.push(a);
  let sharedTracks = 0;
  for (const t of tracksA) if (tracksB.has(t)) sharedTracks++;

  return {
    userA,
    userB,
    score,
    sharedArtists: sharedArtists.slice(0, 8),
    sharedTracks,
    totalA: userTotalPlays(userA),
    totalB: userTotalPlays(userB),
    recommendForA: recommendFromTo(userB, userA, 1),
    recommendForB: recommendFromTo(userA, userB, 1),
  };
}
