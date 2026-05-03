import {
  userArtistVector,
  userTrackSet,
  userTotalPlays,
  userDiscoveryCount,
  userHourBuckets,
  userSignatureTrack,
  recommendFromTo,
  type TopArtistRow,
  type TopTrackRow,
} from "./db.js";

export interface DnaStats {
  slackUser: string;
  totalPlays: number;
  topArtists: TopArtistRow[];
  // Most-played track for the user (used as the "signature track" on the
  // DNA card). Null when the user has no plays.
  signatureTrack: TopTrackRow | null;
  discoveryCount: number;
  discoveryRate: number; // 0-1
}

export function buildDnaStats(slackUser: string): DnaStats {
  const total = userTotalPlays(slackUser);
  const artists = userArtistVector(slackUser).sort((a, b) => b.plays - a.plays);
  const firsts = userDiscoveryCount(slackUser);
  return {
    slackUser,
    totalPlays: total,
    topArtists: artists.slice(0, 5),
    signatureTrack: userSignatureTrack(slackUser),
    discoveryCount: firsts,
    discoveryRate: total > 0 ? firsts / total : 0,
  };
}

export interface CompatStats {
  userA: string;
  userB: string;
  // 0-100 — weighted blend of three components (see buildCompatStats).
  score: number;
  // The three component scores (each in 0-1) so the format layer can show
  // the breakdown if it wants to, and tests can assert on them directly.
  artistJaccard: number;
  artistCosine: number; // play-weighted cosine on the artist vector — our
  // proxy for genre overlap, since we don't store explicit Spotify genres
  // (artists are a strong genre signal in practice for a single channel).
  timeOfDayOverlap: number; // 0-1, cosine on the 24-bucket UTC hour vector
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

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [, v] of a) normA += v * v;
  for (const [, v] of b) normB += v * v;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w !== undefined) dot += v * w;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function hourCosine(
  a: { hour: number; plays: number }[],
  b: { hour: number; plays: number }[],
): number {
  const va = new Array<number>(24).fill(0);
  const vb = new Array<number>(24).fill(0);
  for (const r of a) va[r.hour] = r.plays;
  for (const r of b) vb[r.hour] = r.plays;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < 24; i++) {
    dot += va[i]! * vb[i]!;
    normA += va[i]! * va[i]!;
    normB += vb[i]! * vb[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function buildCompatStats(userA: string, userB: string): CompatStats {
  const artistRowsA = userArtistVector(userA);
  const artistRowsB = userArtistVector(userB);
  const artistsA = new Set(artistRowsA.map((r) => r.artist));
  const artistsB = new Set(artistRowsB.map((r) => r.artist));
  const tracksA = new Set(userTrackSet(userA).map((r) => r.track_id));
  const tracksB = new Set(userTrackSet(userB).map((r) => r.track_id));

  // Component 1: artist Jaccard — "do they listen to the same artists at all?"
  const artistJ = jaccard(artistsA, artistsB);

  // Component 2: play-weighted artist cosine — our genre-overlap proxy.
  // Two people who both heavily play the same artists score higher than two
  // people who happen to have one shared artist each.
  const artistMapA = new Map(artistRowsA.map((r) => [r.artist, r.plays]));
  const artistMapB = new Map(artistRowsB.map((r) => [r.artist, r.plays]));
  const artistC = cosine(artistMapA, artistMapB);

  // Component 3: time-of-day overlap on the 24-bucket UTC hour histogram.
  // Captures lifestyle compatibility ("we're both up at 2am").
  const todC = hourCosine(userHourBuckets(userA), userHourBuckets(userB));

  // 0.5 artist-jaccard + 0.35 artist-cosine (genre proxy) + 0.15 time-of-day.
  // Artist set overlap stays the dominant factor; the cosine and time-of-day
  // terms break ties between two users who share the same set of artists.
  const blended = 0.5 * artistJ + 0.35 * artistC + 0.15 * todC;
  const score = Math.round(blended * 100);

  const sharedArtists: string[] = [];
  for (const a of artistsA) if (artistsB.has(a)) sharedArtists.push(a);
  let sharedTracks = 0;
  for (const t of tracksA) if (tracksB.has(t)) sharedTracks++;

  return {
    userA,
    userB,
    score,
    artistJaccard: artistJ,
    artistCosine: artistC,
    timeOfDayOverlap: todC,
    sharedArtists: sharedArtists.slice(0, 8),
    sharedTracks,
    totalA: userTotalPlays(userA),
    totalB: userTotalPlays(userB),
    recommendForA: recommendFromTo(userB, userA, 1),
    recommendForB: recommendFromTo(userA, userB, 1),
  };
}
