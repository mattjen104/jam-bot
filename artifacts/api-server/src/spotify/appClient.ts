import SpotifyWebApi from "spotify-web-api-node";
import { createSpotifyClient } from "./auth.js";
import type {
  SpotifyCataloguePort,
  SpotifyArtistRef,
  CatalogueTrack,
  CatalogueAlbum,
} from "@workspace/song-enrichment";

/**
 * Application-level Spotify access using the client-credentials grant (NO user
 * OAuth). This powers the public music-graph web app: free-text track search,
 * track lookup, and the artist catalogue port the enrichment lib consumes.
 *
 * It is deliberately separate from the user-OAuth client in `auth.ts`/`client.ts`
 * (which the Slack blend/taste features use). When SPOTIFY_CLIENT_ID/SECRET are
 * absent every lookup degrades gracefully to null/empty so the API still serves.
 */

export function spotifyAppConfigured(): boolean {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

let client: SpotifyWebApi | null = null;
let tokenExpiresAtMs = 0;

async function getClient(): Promise<SpotifyWebApi | null> {
  if (!spotifyAppConfigured()) return null;
  if (!client) client = createSpotifyClient();
  if (Date.now() >= tokenExpiresAtMs) {
    const grant = await client.clientCredentialsGrant();
    client.setAccessToken(grant.body.access_token);
    // Refresh a minute early to avoid edge-of-expiry failures.
    tokenExpiresAtMs = Date.now() + (grant.body.expires_in - 60) * 1000;
  }
  return client;
}

/** A normalized Spotify track carrying everything the routes + enrichment need. */
export interface SpotifyTrackRaw {
  id: string;
  uri: string;
  name: string;
  artists: { id: string; name: string }[];
  album: string | null;
  imageUrl: string | null;
  spotifyUrl: string;
  isrc: string | null;
  durationMs: number;
}

function toRaw(t: SpotifyApi.TrackObjectFull): SpotifyTrackRaw {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
    album: t.album?.name ?? null,
    imageUrl: t.album?.images?.[0]?.url ?? null,
    spotifyUrl: t.external_urls?.spotify ?? `https://open.spotify.com/track/${t.id}`,
    isrc: t.external_ids?.isrc ?? null,
    durationMs: t.duration_ms ?? 0,
  };
}

/** Resolve a free-text query to the single best-match track, or null. */
export async function searchTrack(q: string): Promise<SpotifyTrackRaw | null> {
  const c = await getClient();
  if (!c) return null;
  const res = await c.searchTracks(q, { limit: 1 });
  const item = res.body.tracks?.items?.[0];
  return item ? toRaw(item) : null;
}

/** Look up a track by its Spotify id, or null when missing/unconfigured. */
export async function getTrackById(trackId: string): Promise<SpotifyTrackRaw | null> {
  const c = await getClient();
  if (!c) return null;
  try {
    const res = await c.getTrack(trackId);
    return toRaw(res.body);
  } catch {
    return null;
  }
}

/** Spotify catalogue port the enrichment lib wires for the "catalogue" section. */
export const cataloguePort: SpotifyCataloguePort = {
  async searchArtist(name: string): Promise<SpotifyArtistRef | null> {
    const c = await getClient();
    if (!c) return null;
    const res = await c.searchArtists(name, { limit: 1 });
    const a = res.body.artists?.items?.[0];
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      url: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
    };
  },
  async getArtistTopTracksList(artistId: string): Promise<CatalogueTrack[]> {
    const c = await getClient();
    if (!c) return [];
    const res = await c.getArtistTopTracks(artistId, "US");
    return (res.body.tracks ?? []).map((t) => ({
      id: t.id,
      uri: t.uri,
      title: t.name,
    }));
  },
  async getArtistAlbumsList(artistId: string): Promise<CatalogueAlbum[]> {
    const c = await getClient();
    if (!c) return [];
    const res = await c.getArtistAlbums(artistId, {
      include_groups: "album",
      limit: 20,
    });
    return (res.body.items ?? []).map((al) => ({
      id: al.id,
      name: al.name,
      year: al.release_date ? Number(al.release_date.slice(0, 4)) || undefined : undefined,
      url: al.external_urls?.spotify ?? `https://open.spotify.com/album/${al.id}`,
    }));
  },
};

/** Public Spotify oEmbed payload (auth-free passthrough). */
export interface SpotifyOEmbed {
  html: string;
  title?: string | null;
  thumbnail_url?: string | null;
  width?: number | null;
  height?: number | null;
  provider_name?: string | null;
}

/** Fetch the public Spotify oEmbed for an open.spotify.com URL, or null. */
export async function fetchOEmbed(url: string): Promise<SpotifyOEmbed | null> {
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body.html !== "string") return null;
    return {
      html: body.html,
      title: typeof body.title === "string" ? body.title : null,
      thumbnail_url:
        typeof body.thumbnail_url === "string" ? body.thumbnail_url : null,
      width: typeof body.width === "number" ? body.width : null,
      height: typeof body.height === "number" ? body.height : null,
      provider_name:
        typeof body.provider_name === "string" ? body.provider_name : null,
    };
  } catch {
    return null;
  }
}
