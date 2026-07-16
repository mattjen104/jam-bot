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

/**
 * Spotify rate-limits per APPLICATION (rolling 30s window), so the hundreds of
 * background station-poller lookups share one quota with interactive listener
 * features (casting, saves). When Spotify answers 429 we go quiet for a
 * cooldown window instead of hammering — background enrichment is best-effort,
 * and backing off is what lets interactive playback commands get through.
 */
let cooldownUntilMs = 0;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Global pacing for app-level calls: Spotify's app-wide quota is a rolling
 * ~30s window, and 700+ station pollers can trivially exceed it (we earned a
 * 13-hour penalty once). Serialize all app-client calls with a minimum gap so
 * background enrichment can never saturate the quota again.
 */
const MIN_CALL_GAP_MS = 400;
let paceChain: Promise<void> = Promise.resolve();

function paced<T>(fn: () => Promise<T>): Promise<T | null> {
  const run = paceChain.then(async () => {
    await new Promise((r) => setTimeout(r, MIN_CALL_GAP_MS));
  });
  paceChain = run.catch(() => {});
  return run.then(() => {
    // A 429 may have landed while this call sat in the queue — re-check so
    // pre-queued requests also go quiet during an active cooldown.
    if (spotifyAppInCooldown()) return null;
    return fn();
  });
}

export function spotifyAppInCooldown(): boolean {
  return Date.now() < cooldownUntilMs;
}

function noteRateLimit(err: unknown): void {
  const e = err as { statusCode?: number; headers?: Record<string, string> };
  if (e?.statusCode !== 429) return;
  const retryAfterSec = Number(e.headers?.["retry-after"] ?? NaN);
  const waitMs = Number.isFinite(retryAfterSec)
    ? Math.max(retryAfterSec * 1000, DEFAULT_COOLDOWN_MS)
    : DEFAULT_COOLDOWN_MS;
  const wasQuiet = !spotifyAppInCooldown();
  cooldownUntilMs = Date.now() + waitMs;
  if (wasQuiet) {
    console.warn(
      `[spotify/app] 429 rate limit — pausing app-level Spotify lookups for ${Math.round(waitMs / 1000)}s`,
    );
  }
}

async function getClient(): Promise<SpotifyWebApi | null> {
  if (!spotifyAppConfigured()) return null;
  if (spotifyAppInCooldown()) return null;
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
  albumId: string | null;
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
    albumId: t.album?.id ?? null,
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
  try {
    const res = await paced(() => c.searchTracks(q, { limit: 1 }));
    if (!res) return null;
    const item = res.body.tracks?.items?.[0];
    return item ? toRaw(item) : null;
  } catch (err) {
    noteRateLimit(err);
    throw err;
  }
}

/** Look up a track by its Spotify id, or null when missing/unconfigured. */
export async function getTrackById(trackId: string): Promise<SpotifyTrackRaw | null> {
  const c = await getClient();
  if (!c) return null;
  try {
    const res = await paced(() => c.getTrack(trackId));
    return res ? toRaw(res.body) : null;
  } catch (err) {
    noteRateLimit(err);
    return null;
  }
}

/**
 * Fetch simplified track info for every track on a Spotify album (max 50 per page;
 * we grab the first page which covers virtually all standard albums). Returns an
 * empty array when Spotify is unconfigured or the album lookup fails.
 */
export async function getAlbumTracks(
  albumId: string,
): Promise<{ id: string; name: string; trackNumber: number; isrc: string | null }[]> {
  const c = await getClient();
  if (!c) return [];
  try {
    const res = await paced(() => c.getAlbumTracks(albumId, { limit: 50 }));
    if (!res) return [];
    return (res.body.items ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      trackNumber: t.track_number ?? 0,
      isrc: (t as { external_ids?: { isrc?: string } }).external_ids?.isrc ?? null,
    }));
  } catch (err) {
    noteRateLimit(err);
    return [];
  }
}

/** Spotify catalogue port the enrichment lib wires for the "catalogue" section. */
export const cataloguePort: SpotifyCataloguePort = {
  async searchArtist(name: string): Promise<SpotifyArtistRef | null> {
    const c = await getClient();
    if (!c) return null;
    try {
      const res = await paced(() => c.searchArtists(name, { limit: 1 }));
      if (!res) return null;
      const a = res.body.artists?.items?.[0];
      if (!a) return null;
      return {
        id: a.id,
        name: a.name,
        url: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
      };
    } catch (err) {
      noteRateLimit(err);
      throw err;
    }
  },
  async getArtistTopTracksList(artistId: string): Promise<CatalogueTrack[]> {
    const c = await getClient();
    if (!c) return [];
    try {
      const res = await paced(() => c.getArtistTopTracks(artistId, "US"));
      if (!res) return [];
      return (res.body.tracks ?? []).map((t) => ({
        id: t.id,
        uri: t.uri,
        title: t.name,
      }));
    } catch (err) {
      noteRateLimit(err);
      throw err;
    }
  },
  async getArtistAlbumsList(artistId: string): Promise<CatalogueAlbum[]> {
    const c = await getClient();
    if (!c) return [];
    try {
      const res = await paced(() =>
        c.getArtistAlbums(artistId, { include_groups: "album", limit: 20 }),
      );
      if (!res) return [];
      return (res.body.items ?? []).map((al) => ({
        id: al.id,
        name: al.name,
        year: al.release_date ? Number(al.release_date.slice(0, 4)) || undefined : undefined,
        url: al.external_urls?.spotify ?? `https://open.spotify.com/album/${al.id}`,
      }));
    } catch (err) {
      noteRateLimit(err);
      throw err;
    }
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
