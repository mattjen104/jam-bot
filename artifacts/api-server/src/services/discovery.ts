import { type User, type CachedTrack } from "@workspace/db/schema";
import { getUserTracks } from "../spotify/data";

interface GemTrack {
  spotifyTrackId: string;
  trackName: string;
  artistNames: string[];
  albumName: string | null;
  albumImageUrl: string | null;
  ownedBy: string;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
}

export async function findHiddenGems(
  users: User[],
  maxPerUser: number = 5
): Promise<GemTrack[]> {
  const userTracksMap = new Map<number, CachedTrack[]>();
  const allTrackOwners = new Map<string, Set<number>>();

  for (const user of users) {
    const tracks = await getUserTracks(user.id);
    userTracksMap.set(user.id, tracks);

    for (const track of tracks) {
      if (!allTrackOwners.has(track.spotifyTrackId)) {
        allTrackOwners.set(track.spotifyTrackId, new Set());
      }
      allTrackOwners.get(track.spotifyTrackId)!.add(user.id);
    }
  }

  const gems: GemTrack[] = [];

  for (const user of users) {
    const tracks = userTracksMap.get(user.id) || [];
    const uniqueTracks = tracks.filter((t) => {
      const owners = allTrackOwners.get(t.spotifyTrackId)!;
      return owners.size === 1;
    });

    const topSources = ["top_short", "top_medium"];
    const prioritized = uniqueTracks.sort((a, b) => {
      const aTopPriority = topSources.includes(a.source) ? 1 : 0;
      const bTopPriority = topSources.includes(b.source) ? 1 : 0;
      if (bTopPriority !== aTopPriority) return bTopPriority - aTopPriority;
      return (b.popularity || 0) - (a.popularity || 0);
    });

    const seen = new Set<string>();
    let count = 0;
    for (const track of prioritized) {
      if (count >= maxPerUser) break;
      if (seen.has(track.spotifyTrackId)) continue;
      seen.add(track.spotifyTrackId);
      count++;

      gems.push({
        spotifyTrackId: track.spotifyTrackId,
        trackName: track.trackName,
        artistNames: JSON.parse(track.artistNames),
        albumName: track.albumName,
        albumImageUrl: track.albumImageUrl,
        ownedBy: user.spotifyDisplayName || user.slackDisplayName || "Unknown",
        energy: track.energy,
        danceability: track.danceability,
        valence: track.valence,
      });
    }
  }

  return gems;
}

export async function whobroughtItFirst(
  users: User[]
): Promise<Array<{ trackName: string; artistNames: string[]; albumImageUrl: string | null; sharedBy: string[]; spotifyTrackId: string }>> {
  const trackFirstSeen = new Map<string, { track: CachedTrack; users: Map<string, string> }>();

  for (const user of users) {
    const tracks = await getUserTracks(user.id);
    const displayName = user.spotifyDisplayName || user.slackDisplayName || "Unknown";

    for (const track of tracks) {
      if (!trackFirstSeen.has(track.spotifyTrackId)) {
        trackFirstSeen.set(track.spotifyTrackId, {
          track,
          users: new Map(),
        });
      }

      const entry = trackFirstSeen.get(track.spotifyTrackId)!;
      if (!entry.users.has(displayName)) {
        const sourceRank: Record<string, number> = {
          top_long: 1,
          top_medium: 2,
          top_short: 3,
          saved: 4,
          recent: 5,
        };
        entry.users.set(displayName, track.source);
      }
    }
  }

  const shared = [...trackFirstSeen.entries()]
    .filter(([, data]) => data.users.size >= 2)
    .map(([trackId, data]) => {
      const sourceRank: Record<string, number> = {
        top_long: 1,
        top_medium: 2,
        top_short: 3,
        saved: 4,
        recent: 5,
      };

      const sorted = [...data.users.entries()].sort((a, b) => {
        return (sourceRank[a[1]] || 99) - (sourceRank[b[1]] || 99);
      });

      return {
        spotifyTrackId: trackId,
        trackName: data.track.trackName,
        artistNames: JSON.parse(data.track.artistNames) as string[],
        albumImageUrl: data.track.albumImageUrl,
        sharedBy: sorted.map(([name, source]) => `${name} (${source.replace("top_", "top ")})`),
      };
    })
    .sort((a, b) => b.sharedBy.length - a.sharedBy.length)
    .slice(0, 15);

  return shared;
}
