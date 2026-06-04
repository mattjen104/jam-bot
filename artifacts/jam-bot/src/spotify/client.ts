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

/**
 * Single-attempt wrapper for non-idempotent mutations
 * (`play`, `addToQueue`, `skipToNext`, `transferMyPlayback`).
 *
 * Spotify's playback-mutation endpoints do NOT accept an idempotency key,
 * so a retry after a timeout can produce a second skip / double-queue
 * even when the original call actually succeeded. Friends saw this as
 * "the bot skips through the album" / "queues a track twice."
 *
 * We still do the pre-flight token refresh and ONE on-401 retry (a 401
 * means the token expired before we used it — refreshing and retrying
 * is safe because the previous attempt was rejected, not executed).
 * Everything else (5xx, 429, timeout) is surfaced to the caller after
 * a single attempt.
 */
async function withOnce<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    await withTimeout(`${label}:refreshToken`, ensureAccessToken());
    return await withTimeout(label, fn());
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 401) {
      // Token was just-expired; safe to retry once after refresh.
      accessTokenExpiresAt = 0;
      await withTimeout(`${label}:refreshToken`, ensureAccessToken());
      return await withTimeout(label, fn());
    }
    logger.warn(`Spotify mutation failed (no retry): ${label}`, {
      status,
      error: String(err),
    });
    throw err;
  }
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
    /** International Standard Recording Code, when Spotify exposes one. */
    isrc?: string;
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
        isrc: t.external_ids?.isrc,
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
  return withOnce("addToQueue", async () => {
    await api.addToQueue(uri, deviceId ? { device_id: deviceId } : undefined);
  });
}

export async function playNow(uri: string, deviceId?: string) {
  return withOnce("play", async () => {
    await api.play({
      uris: [uri],
      ...(deviceId ? { device_id: deviceId } : {}),
    });
  });
}

export async function skipToNext(deviceId?: string) {
  return withOnce("skipToNext", async () => {
    await api.skipToNext(deviceId ? { device_id: deviceId } : undefined);
  });
}

/**
 * Seek the current playback to an absolute position (ms from the track
 * start). Used by turntable sync to line the host account up with the
 * analog source. Non-idempotent (it mutates the live player) so it runs
 * through `withOnce` — but unlike skip/queue, a blind retry of a seek is
 * harmless (seeking to the same absolute position twice is a no-op), so a
 * caller that wants to retry can safely do so. Position is clamped to >= 0
 * and rounded; Spotify rejects negative/float positions.
 */
export async function seek(positionMs: number, deviceId?: string) {
  const pos = Math.max(0, Math.round(positionMs));
  return withOnce("seek", async () => {
    await api.seek(pos, deviceId ? { device_id: deviceId } : undefined);
  });
}

/**
 * Resolve a recording to a Spotify track by its ISRC (International
 * Standard Recording Code). ACRCloud returns an ISRC for most commercial
 * releases, and `isrc:` is an exact Spotify search filter, so this is the
 * most precise way to map a fingerprint match to the right Spotify track
 * (correct mix/master, not a random cover or live version). Returns null
 * when the ISRC is missing or Spotify has no matching track — callers
 * should then fall back to a title/artist `searchTrack`.
 */
export async function searchTrackByIsrc(
  isrc: string,
): Promise<SearchResultTrack | null> {
  const clean = isrc.trim();
  if (!clean) return null;
  return withRetry("searchTracksByIsrc", async () => {
    const res = await api.searchTracks(`isrc:${clean}`, { limit: 1 });
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

/**
 * Returns the device id that Spotify currently considers active for
 * playback, or null if no device is. `/me/player` updates in lockstep with
 * playback, so it's the most reliable signal for "what is the account
 * playing on right now".
 */
export async function getActivePlaybackDeviceId(): Promise<string | null> {
  return withRetry("getMyCurrentPlaybackState", async () => {
    const res = await api.getMyCurrentPlaybackState();
    return res.body?.device?.id ?? null;
  });
}

/**
 * Resolve the Spotify device the bot should act on: whatever the account is
 * currently playing on (phone, laptop, speaker — whatever). Prefers the
 * device Spotify reports as active for the live playback session
 * (`/me/player`), then falls back to any device flagged active in the device
 * list (the `is_active` flag can lag the live session by a few seconds).
 * Returns null when nothing is active — callers should then tell the user to
 * open Spotify and start playing something.
 */
export async function findActiveDevice(): Promise<DeviceInfo | null> {
  const [devices, activeId] = await Promise.all([
    listDevices(),
    getActivePlaybackDeviceId().catch(() => null),
  ]);
  // `/me/player` is authoritative for the live session. Prefer the matching
  // entry (full name/flags); if the device list hasn't caught up yet — a brief
  // eventual-consistency window where `/me/player` reports an id that
  // `/me/player/devices` doesn't list — still target that id directly so we
  // don't falsely report "no active device".
  if (activeId) {
    const match = devices.find((d) => d.id === activeId);
    if (match) return match;
    return { id: activeId, name: "active device", isActive: true };
  }
  // No live session id — fall back to whatever device the list flags active.
  return devices.find((d) => d.isActive) ?? null;
}

export async function getArtistInfo(artistId: string) {
  return withRetry("getArtist", async () => (await api.getArtist(artistId)).body);
}

export interface CreatedPlaylist {
  id: string;
  url: string;
}

/**
 * Create a playlist on the connected account and add the given track URIs to
 * it. Used to persist a guided tour as a real, replayable Spotify playlist.
 *
 * Both the create and the add-tracks calls are non-idempotent mutations, so
 * each runs through `withOnce` (single attempt + on-401 refresh) rather than
 * `withRetry`: a blind retry after a timeout could create a duplicate
 * playlist or double-add tracks even when the original call succeeded.
 *
 * Requires the `playlist-modify-public` / `playlist-modify-private` scope on
 * the refresh token. Without it Spotify returns 403 — surfaced to the caller
 * so it can point the user at the re-auth step in SETUP.md.
 */
export async function createPlaylistWithTracks(args: {
  name: string;
  description: string;
  uris: string[];
  isPublic?: boolean;
}): Promise<CreatedPlaylist> {
  const { name, description, uris, isPublic = true } = args;
  const created = await withOnce("createPlaylist", async () =>
    api.createPlaylist(name, { description, public: isPublic }),
  );
  const id = created.body.id;
  const url =
    created.body.external_urls?.spotify ??
    `https://open.spotify.com/playlist/${id}`;
  // Spotify caps add-tracks at 100 URIs per call; tours are far smaller than
  // that, but chunk defensively so a future longer set can't 400.
  for (let i = 0; i < uris.length; i += 100) {
    const chunk = uris.slice(i, i + 100);
    if (!chunk.length) continue;
    await withOnce("addTracksToPlaylist", async () => {
      await api.addTracksToPlaylist(id, chunk);
    });
  }
  return { id, url };
}
