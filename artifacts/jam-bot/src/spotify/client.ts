import SpotifyWebApi from "spotify-web-api-node";
import { config } from "../config.js";
import { logger } from "../logger.js";

const api = new SpotifyWebApi({
  clientId: config.SPOTIFY_CLIENT_ID,
  clientSecret: config.SPOTIFY_CLIENT_SECRET,
  refreshToken: config.SPOTIFY_REFRESH_TOKEN,
});

let accessTokenExpiresAt = 0;

async function ensureAccessToken(): Promise<void> {
  if (Date.now() < accessTokenExpiresAt - 60_000) return;
  const res = await api.refreshAccessToken();
  api.setAccessToken(res.body.access_token);
  accessTokenExpiresAt = Date.now() + res.body.expires_in * 1000;
  logger.debug("Refreshed Spotify access token", {
    expires_in: res.body.expires_in,
  });
}

const SPOTIFY_CALL_TIMEOUT_MS = 15_000;

function withTimeout<T>(label: string, p: Promise<T>, ms = SPOTIFY_CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`Spotify call timed out after ${ms}ms: ${label}`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await withTimeout(`${label}:refreshToken`, ensureAccessToken());
      return await withTimeout(label, fn());
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 401) {
        accessTokenExpiresAt = 0;
        continue;
      }
      if (status === 429) {
        const retryAfter =
          Number(
            (err as { headers?: Record<string, string> })?.headers?.[
              "retry-after"
            ],
          ) || 1;
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
        continue;
      }
      if (status && status >= 500) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  logger.error(`Spotify call failed: ${label}`, { error: String(lastErr) });
  throw lastErr;
}

export interface CurrentlyPlaying {
  isPlaying: boolean;
  track?: {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumImageUrl?: string;
    durationMs: number;
    progressMs: number;
    spotifyUrl: string;
    artistIds: string[];
  };
}

export async function getCurrentlyPlaying(): Promise<CurrentlyPlaying> {
  return withRetry("getMyCurrentPlayingTrack", async () => {
    const res = await api.getMyCurrentPlayingTrack();
    const item = res.body.item;
    if (!item || item.type !== "track") return { isPlaying: false };
    const t = item as SpotifyApi.TrackObjectFull;
    return {
      isPlaying: res.body.is_playing ?? false,
      track: {
        id: t.id,
        title: t.name,
        artist: t.artists.map((a) => a.name).join(", "),
        album: t.album.name,
        albumImageUrl: t.album.images[0]?.url,
        durationMs: t.duration_ms,
        progressMs: res.body.progress_ms ?? 0,
        spotifyUrl: t.external_urls.spotify,
        artistIds: t.artists.map((a) => a.id),
      },
    };
  });
}

export interface SearchResultTrack {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
}

export async function searchTrack(
  query: string,
): Promise<SearchResultTrack | null> {
  return withRetry("searchTracks", async () => {
    const res = await api.searchTracks(query, { limit: 5 });
    const t = res.body.tracks?.items[0];
    if (!t) return null;
    return {
      id: t.id,
      uri: t.uri,
      title: t.name,
      artist: t.artists.map((a) => a.name).join(", "),
      album: t.album.name,
      durationMs: t.duration_ms,
    };
  });
}

export async function addToQueue(uri: string, deviceId?: string) {
  return withRetry("addToQueue", async () => {
    await api.addToQueue(uri, deviceId ? { device_id: deviceId } : undefined);
  });
}

export async function playNow(uri: string, deviceId?: string) {
  return withRetry("play", async () => {
    await api.play({
      uris: [uri],
      ...(deviceId ? { device_id: deviceId } : {}),
    });
  });
}

export async function skipToNext(deviceId?: string) {
  return withRetry("skipToNext", async () => {
    await api.skipToNext(deviceId ? { device_id: deviceId } : undefined);
  });
}

export async function getRecentlyPlayed(limit = 20) {
  return withRetry("getMyRecentlyPlayedTracks", async () => {
    const res = await api.getMyRecentlyPlayedTracks({ limit });
    return res.body.items;
  });
}

export interface DeviceInfo {
  id: string;
  name: string;
  isActive: boolean;
}
export async function listDevices(): Promise<DeviceInfo[]> {
  return withRetry("getMyDevices", async () => {
    const res = await api.getMyDevices();
    return (res.body.devices ?? []).map((d) => ({
      id: d.id ?? "",
      name: d.name,
      isActive: d.is_active,
    }));
  });
}

export async function findHostDevice(): Promise<DeviceInfo | null> {
  const devices = await listDevices();
  return devices.find((d) => d.name === config.SPOTIFY_DEVICE_NAME) ?? null;
}

export async function transferPlaybackTo(deviceId: string, play = false) {
  return withRetry("transferMyPlayback", async () => {
    await api.transferMyPlayback([deviceId], { play });
  });
}

export async function ensurePlaybackOnHost(): Promise<DeviceInfo | null> {
  const host = await findHostDevice();
  if (!host) return null;
  if (!host.isActive) {
    await transferPlaybackTo(host.id, false);
    logger.info(`Transferred playback to host device "${host.name}"`);
  }
  return host;
}

export async function getArtistInfo(artistId: string) {
  return withRetry("getArtist", async () => (await api.getArtist(artistId)).body);
}
