/**
 * Injectable Spotify catalogue port.
 *
 * catalogue.ts needs a few read-only Spotify lookups (artist search + an
 * artist's top tracks and albums). jam-bot wires its existing Spotify client;
 * the API server wires a client-credentials client. When no port is configured,
 * the lookups degrade gracefully (artist search returns null → catalogue is
 * omitted), so the lib builds and runs without Spotify credentials.
 */

/** A minimal reference to a Spotify artist. */
export interface SpotifyArtistRef {
  id: string;
  name: string;
  url: string;
}

/** A playable track snapshot carrying the ids queue buttons / players need. */
export interface CatalogueTrack {
  id: string;
  uri: string;
  title: string;
}

/** A release (full-length album) credited to an artist. */
export interface CatalogueAlbum {
  id: string;
  name: string;
  year?: number;
  url: string;
}

export interface SpotifyCataloguePort {
  searchArtist(name: string): Promise<SpotifyArtistRef | null>;
  getArtistTopTracksList(artistId: string): Promise<CatalogueTrack[]>;
  getArtistAlbumsList(artistId: string): Promise<CatalogueAlbum[]>;
}

let port: SpotifyCataloguePort | null = null;

export function configureEnrichmentSpotify(next: SpotifyCataloguePort): void {
  port = next;
}

export async function searchArtist(name: string): Promise<SpotifyArtistRef | null> {
  if (!port) return null;
  return port.searchArtist(name);
}

export async function getArtistTopTracksList(artistId: string): Promise<CatalogueTrack[]> {
  if (!port) return [];
  return port.getArtistTopTracksList(artistId);
}

export async function getArtistAlbumsList(artistId: string): Promise<CatalogueAlbum[]> {
  if (!port) return [];
  return port.getArtistAlbumsList(artistId);
}
