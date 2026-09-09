import {
  fetchReleaseGroupTracklist,
  type AlbumTracklist,
} from "@workspace/song-enrichment";

type TracklistFetcher = (
  releaseGroupMbid: string,
) => Promise<AlbumTracklist | null>;

let tracklistFetcher: TracklistFetcher = fetchReleaseGroupTracklist;

export interface CanonicallyOrderedTrack<T> {
  track: T;
  position: number;
}

/**
 * Intersects Lore's locally held release-group recordings with MusicBrainz's
 * canonical medium/track order. A null result is intentional: callers that
 * require sequence integrity must disable playback rather than guess.
 */
export async function orderAlbumTracksCanonically<T extends { mbid: string }>(
  releaseGroupMbid: string,
  localTracks: T[],
): Promise<CanonicallyOrderedTrack<T>[] | null> {
  const tracklist = await tracklistFetcher(releaseGroupMbid);
  if (!tracklist) return null;

  const localByMbid = new Map(localTracks.map((track) => [track.mbid, track]));
  const ordered = tracklist.tracks.flatMap(({ recordingId, position }) => {
    const track = localByMbid.get(recordingId);
    return track ? [{ track, position }] : [];
  });
  return ordered.length > 0 ? ordered : null;
}

export function __setAlbumTracklistFetcherForTests(
  fetcher: TracklistFetcher | null,
): void {
  tracklistFetcher = fetcher ?? fetchReleaseGroupTracklist;
}