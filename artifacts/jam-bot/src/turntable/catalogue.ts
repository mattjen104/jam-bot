import { logger } from "../logger.js";
import {
  searchArtist,
  getArtistTopTracksList,
  getArtistAlbumsList,
  type CatalogueTrack,
  type CatalogueAlbum,
} from "../spotify/client.js";

/**
 * A playable snapshot of an artist's catalogue for the track card's "Genre &
 * context" tab: their top tracks and full-length albums, each carrying the
 * Spotify ids the queue buttons need. This is the actionable, song-relevant
 * replacement for the old repetitive artist Wikipedia bio.
 */
export interface ArtistCatalogue {
  artistId: string;
  artistName: string;
  artistUrl: string;
  topTracks: CatalogueTrack[];
  albums: CatalogueAlbum[];
}

export function catalogueHasContent(c?: ArtistCatalogue | null): boolean {
  return !!c && (c.topTracks.length > 0 || c.albums.length > 0);
}

// In-memory cache keyed by Spotify artist id. The catalogue changes rarely and
// the same artist often plays several tracks in a row, so this spares repeated
// Spotify calls. Bounded with insertion-order eviction; cleared on restart.
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX = 100;
const cache = new Map<string, { at: number; value: ArtistCatalogue | null }>();

/**
 * Fetch an artist's playable catalogue (top tracks + albums) for the card. The
 * Spotify artist id comes from the now-playing track's ids when present
 * (jam/tour cards), otherwise it's resolved by name search (turntable cards,
 * which carry no Spotify artist id). Cached per artist id. Never throws — a
 * failure just yields null and the tab falls back to its other content.
 */
export async function fetchArtistCatalogue(args: {
  artistName: string;
  spotifyArtistId?: string | null;
}): Promise<ArtistCatalogue | null> {
  try {
    let id = args.spotifyArtistId?.trim() || null;
    let name = args.artistName?.trim() || "";
    let url = id ? `https://open.spotify.com/artist/${id}` : "";

    if (!id) {
      if (!name) return null;
      const ref = await searchArtist(name);
      if (!ref) return null;
      id = ref.id;
      name = ref.name || name;
      url = ref.url;
    }

    const cached = cache.get(id);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

    const [topTracks, albums] = await Promise.all([
      getArtistTopTracksList(id).catch(() => [] as CatalogueTrack[]),
      getArtistAlbumsList(id).catch(() => [] as CatalogueAlbum[]),
    ]);

    const value: ArtistCatalogue | null =
      topTracks.length || albums.length
        ? { artistId: id, artistName: name, artistUrl: url, topTracks, albums }
        : null;

    cache.set(id, { at: Date.now(), value });
    while (cache.size > MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return value;
  } catch (err) {
    logger.warn("Artist catalogue fetch failed", { error: String(err) });
    return null;
  }
}

/** Test/maintenance helper. */
export function clearCatalogueCache(): void {
  cache.clear();
}
