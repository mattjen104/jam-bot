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

/**
 * Spotify rate-limit circuit breaker.
 *
 * When Spotify returns 429 it includes a `Retry-After` (seconds). That value
 * can be tiny (a transient burst) or huge — a quota-level limit can return
 * `Retry-After: 7911` (~2.2h). The old behavior slept `Retry-After+1` seconds
 * *inside the call* and then retried, so a single call could block for hours
 * AND every poll tick spawned another one, hammering the limited endpoint and
 * extending the window. This breaker records a shared "don't call Spotify until"
 * timestamp; while it's open, all calls fail fast WITHOUT touching the network,
 * so polling pauses for the duration Spotify asked for instead of spiraling.
 *
 * Short transient 429s (<= INLINE_RETRY_MAX_S) are still retried in-call as
 * before, so the common "recover from a brief burst" path is unchanged.
 */
let rateLimitedUntil = 0;
const INLINE_RETRY_MAX_S = 5;

class SpotifyRateLimitedError extends Error {
  readonly statusCode = 429;
  constructor(public readonly remainingMs: number) {
    super(
      `Spotify rate-limited; backing off for ${Math.ceil(
        remainingMs / 1000,
      )}s before any further calls`,
    );
    this.name = "SpotifyRateLimitedError";
  }
}

/** Milliseconds remaining on the active rate-limit pause, or 0 if none. */
export function spotifyRateLimitRemainingMs(): number {
  return Math.max(0, rateLimitedUntil - Date.now());
}

/** True when `err` is a Spotify rate-limit error thrown by this client. */
export function isSpotifyRateLimited(err: unknown): err is Error {
  return err instanceof Error && err.name === "SpotifyRateLimitedError";
}

function openRateLimitBreaker(retryAfterSec: number): void {
  const until = Date.now() + (retryAfterSec + 1) * 1000;
  if (until <= rateLimitedUntil) return;
  rateLimitedUntil = until;
  logger.warn("Spotify rate-limited; pausing all Spotify calls", {
    retryAfterSec,
    until: new Date(rateLimitedUntil).toISOString(),
  });
}

/** Throws fast (no network) when the breaker is open. */
function assertRateLimitBreakerClosed(): void {
  const remaining = spotifyRateLimitRemainingMs();
  if (remaining > 0) throw new SpotifyRateLimitedError(remaining);
}

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
      // Fail fast if Spotify already told us to back off — don't touch the
      // network (token refresh OR the call) while the breaker is open.
      assertRateLimitBreakerClosed();
      await withTimeout(`${label}:refreshToken`, ensureAccessToken());
      return await withTimeout(label, fn());
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { statusCode?: number })?.statusCode;
      if (err instanceof SpotifyRateLimitedError) {
        // Breaker is open — stop retrying, surface immediately.
        throw err;
      }
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
        // Big quota-level limits open the shared breaker and bail fast so we
        // don't sleep for hours in-call or let every poll tick re-hammer the
        // limited endpoint. Small transient bursts retry in-call as before.
        if (retryAfter > INLINE_RETRY_MAX_S) {
          openRateLimitBreaker(retryAfter);
          throw new SpotifyRateLimitedError(spotifyRateLimitRemainingMs());
        }
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
    // Honor an open rate-limit breaker for mutations too — bail before any
    // network call so a queued skip/queue can't re-poke a limited endpoint.
    assertRateLimitBreakerClosed();
    await withTimeout(`${label}:refreshToken`, ensureAccessToken());
    return await withTimeout(label, fn());
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (err instanceof SpotifyRateLimitedError) throw err;
    if (status === 401) {
      // Token was just-expired; safe to retry once after refresh.
      accessTokenExpiresAt = 0;
      await withTimeout(`${label}:refreshToken`, ensureAccessToken());
      return await withTimeout(label, fn());
    }
    // A 429 on a mutation opens the shared breaker so subsequent polling pauses.
    if (status === 429) {
      const retryAfter =
        Number(
          (err as { headers?: Record<string, string> })?.headers?.[
            "retry-after"
          ],
        ) || 1;
      openRateLimitBreaker(retryAfter);
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

export interface SpotifyArtistRef {
  id: string;
  name: string;
  url: string;
}

/**
 * Resolve an artist NAME to its Spotify artist (best match). Used to build the
 * card catalogue for sources that don't carry Spotify artist ids (e.g. the
 * turntable path, where the card was matched by ISRC/title). Returns null when
 * nothing resolves.
 */
export async function searchArtist(
  name: string,
): Promise<SpotifyArtistRef | null> {
  const q = name.trim();
  if (!q) return null;
  return withRetry("searchArtists", async () => {
    const res = await api.searchArtists(q, { limit: 1 });
    const a = res.body.artists?.items[0];
    if (!a) return null;
    return {
      id: a.id,
      name: a.name,
      url: a.external_urls?.spotify ?? `https://open.spotify.com/artist/${a.id}`,
    };
  });
}

export interface CatalogueTrack {
  id: string;
  uri: string;
  title: string;
}

/** An artist's top tracks (Spotify's popularity-ordered list for a market). */
export async function getArtistTopTracksList(
  artistId: string,
  country = "US",
): Promise<CatalogueTrack[]> {
  return withRetry("getArtistTopTracks", async () => {
    const res = await api.getArtistTopTracks(artistId, country);
    return (res.body.tracks ?? []).map((t) => ({
      id: t.id,
      uri: t.uri,
      title: t.name,
    }));
  });
}

export interface CatalogueAlbum {
  id: string;
  name: string;
  year?: number;
  url: string;
}

/**
 * An artist's full-length albums, deduped by name (Spotify lists reissues /
 * remasters / market variants of the same album many times). Newest pressing of
 * each title wins by insertion order from the API.
 */
export async function getArtistAlbumsList(
  artistId: string,
  country = "US",
): Promise<CatalogueAlbum[]> {
  return withRetry("getArtistAlbums", async () => {
    const res = await api.getArtistAlbums(artistId, {
      include_groups: "album",
      country,
      limit: 50,
    });
    const seen = new Set<string>();
    const out: CatalogueAlbum[] = [];
    for (const a of res.body.items ?? []) {
      const key = a.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const yr = a.release_date
        ? Number.parseInt(a.release_date.slice(0, 4), 10)
        : NaN;
      out.push({
        id: a.id,
        name: a.name,
        year: Number.isFinite(yr) ? yr : undefined,
        url:
          a.external_urls?.spotify ??
          `https://open.spotify.com/album/${a.id}`,
      });
    }
    return out;
  });
}

/** Track URIs for an album, in order, capped so a queue-album tap can't flood. */
export async function getAlbumTrackUris(
  albumId: string,
  cap = 12,
): Promise<string[]> {
  const limit = Math.min(50, Math.max(1, cap));
  return withRetry("getAlbumTracks", async () => {
    const res = await api.getAlbumTracks(albumId, { limit });
    return (res.body.items ?? [])
      .map((t) => t.uri)
      .filter((u): u is string => !!u)
      .slice(0, cap);
  });
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
