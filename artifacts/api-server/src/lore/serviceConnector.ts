/**
 * Pluggable service-connector interface for streaming-library integration.
 *
 * Each connector handles OAuth, paged library import, and optional Keep
 * mirroring for one streaming service.  Routes look up connectors by service
 * name via `connectorRegistry`.
 *
 * Only Spotify is implemented in this version.
 */

import type { Recording } from "@workspace/db";
import {
  resolveSpotifyTrack,
  trackIdFromUri,
} from "./spotifyConnect.js";

const ACCOUNTS_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";

// ---------------------------------------------------------------------------
// Shared interfaces
// ---------------------------------------------------------------------------

/** One raw track yielded by importLibrary — not yet MBID-resolved. */
export interface RawLibraryTrack {
  artist: string;
  title: string;
  isrc?: string;
  durationMs?: number;
  /** Service-internal id for dedup (e.g. Spotify track id). */
  externalId?: string;
}

/** Token bundle returned by authCallback. */
export interface ConnectorTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string;
  canWrite: boolean;
}

/** Result of mirroring a Keep to a streaming service. */
export interface MirrorResult {
  ok: boolean;
  /** If the service cannot write, a link the user can open to save manually. */
  linkOut?: string;
}

export interface ServiceConnector {
  /** Builds the OAuth authorization URL (browser redirect). */
  authStart(state: string, redirectUri: string): string;

  /**
   * Exchanges an authorization code for tokens.  Returns token bundle
   * including the derived canWrite flag.
   */
  authCallback(code: string, redirectUri: string): Promise<ConnectorTokens>;

  /**
   * Async iterable over all tracks in the user's library.  May page lazily.
   * The caller must NOT call MusicBrainz inside this loop — resolution happens
   * outside (in the import worker), respecting the 1 req/sec budget.
   */
  importLibrary(accessToken: string): AsyncIterable<RawLibraryTrack>;

  /**
   * Mirror a kept recording to the service's library.
   * `recording` provides the MBID + metadata to resolve a Spotify URI.
   */
  addToLibrary(
    accessToken: string,
    recording: Pick<Recording, "mbid" | "title" | "artist" | "isrc" | "links">,
  ): Promise<MirrorResult>;

  /**
   * Check whether a recording (identified by ISRC) is already saved in the
   * user's streaming-service library.  Returns false on lookup failure.
   * Used by the Keep flow to avoid duplicate saves and to surface
   * already-saved indicators in the UI.
   */
  catalogHas(accessToken: string, isrc: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// SpotifyConnector
// ---------------------------------------------------------------------------

/**
 * Library OAuth scopes (separate from the playback-scoped tokens stored in
 * `spotify_connections`).  We request both read and modify up front so the
 * connector can be used for import AND mirroring in one consent screen.
 */
const LIBRARY_SCOPES = [
  "user-library-read",
  "user-library-modify",
].join(" ");

function spotifyBasicAuth(): string {
  const id = process.env.SPOTIFY_CLIENT_ID ?? "";
  const secret = process.env.SPOTIFY_CLIENT_SECRET ?? "";
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

interface SpotifyTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

async function spotifyTokenRequest(
  body: URLSearchParams,
): Promise<SpotifyTokenResponse> {
  const res = await fetch(`${ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: spotifyBasicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Spotify token request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  return (await res.json()) as SpotifyTokenResponse;
}

function spotifyExpiresAt(expiresInSeconds: number): Date {
  return new Date(Date.now() + Math.max(0, expiresInSeconds - 60) * 1000);
}

/** Saved-tracks page from GET /me/tracks */
interface SpotifyTracksPage {
  items: Array<{
    added_at?: string;
    track: {
      id: string;
      name: string;
      duration_ms: number;
      artists: Array<{ name: string }>;
      external_ids?: { isrc?: string };
    } | null;
  }>;
  next: string | null;
  total: number;
}

export class SpotifyConnector implements ServiceConnector {
  authStart(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: process.env.SPOTIFY_CLIENT_ID ?? "",
      response_type: "code",
      redirect_uri: redirectUri,
      scope: LIBRARY_SCOPES,
      state,
    });
    return `${ACCOUNTS_BASE}/authorize?${params.toString()}`;
  }

  async authCallback(
    code: string,
    redirectUri: string,
  ): Promise<ConnectorTokens> {
    const data = await spotifyTokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    );
    if (!data.refresh_token) {
      throw new Error("Spotify library OAuth returned no refresh_token");
    }
    const scopes = data.scope ?? LIBRARY_SCOPES;
    const canWrite = scopes.includes("user-library-modify");
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: spotifyExpiresAt(data.expires_in),
      scopes,
      canWrite,
    };
  }

  async *importLibrary(accessToken: string): AsyncIterable<RawLibraryTrack> {
    let url: string | null = `${API_BASE}/me/tracks?limit=50`;
    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Spotify saved-tracks fetch failed (${res.status}): ${body.slice(0, 200)}`,
        );
      }
      const page = (await res.json()) as SpotifyTracksPage;
      for (const item of page.items) {
        const track = item.track;
        if (!track) continue;
        yield {
          artist: track.artists[0]?.name ?? "",
          title: track.name,
          isrc: track.external_ids?.isrc,
          durationMs: track.duration_ms,
          externalId: track.id,
        };
      }
      url = page.next;
    }
  }

  async catalogHas(accessToken: string, isrc: string): Promise<boolean> {
    if (!isrc) return false;
    try {
      // Step 1: resolve ISRC → Spotify track id.
      const searchRes = await fetch(
        `${API_BASE}/search?q=${encodeURIComponent(`isrc:${isrc}`)}&type=track&limit=1`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!searchRes.ok) return false;
      const searchBody = (await searchRes.json()) as {
        tracks?: { items?: Array<{ id: string }> };
      };
      const trackId = searchBody.tracks?.items?.[0]?.id;
      if (!trackId) return false;

      // Step 2: check saved-tracks membership.
      const containsRes = await fetch(
        `${API_BASE}/me/tracks/contains?ids=${encodeURIComponent(trackId)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!containsRes.ok) return false;
      const flags = (await containsRes.json()) as boolean[];
      return flags[0] === true;
    } catch {
      return false;
    }
  }

  async addToLibrary(
    accessToken: string,
    recording: Pick<Recording, "mbid" | "title" | "artist" | "isrc" | "links">,
  ): Promise<MirrorResult> {
    const resolved = await resolveSpotifyTrack(recording);
    if (!resolved) {
      const q = encodeURIComponent(`${recording.artist} ${recording.title}`);
      return {
        ok: false,
        linkOut: `https://open.spotify.com/search/${q}`,
      };
    }

    const trackId = trackIdFromUri(resolved.uri);
    if (!trackId) {
      return { ok: false };
    }

    const res = await fetch(
      `${API_BASE}/me/tracks?ids=${encodeURIComponent(trackId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ids: [trackId] }),
      },
    );

    if (res.ok) return { ok: true };

    const body = await res.text().catch(() => "");
    console.error(
      `[spotify-connector] addToLibrary failed (${res.status}): ${body.slice(0, 200)}`,
    );
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const connectorRegistry = new Map<string, ServiceConnector>([
  ["spotify", new SpotifyConnector()],
]);

export function getConnector(service: string): ServiceConnector | null {
  return connectorRegistry.get(service) ?? null;
}

/**
 * Refresh a service connection's access token when it is expired/close to
 * expiry.  Returns { accessToken, expiresAt } on success.  The caller should
 * persist the updated tokens.
 */
export async function refreshServiceToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date; scopes: string }> {
  const data = await spotifyTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
  return {
    accessToken: data.access_token,
    expiresAt: spotifyExpiresAt(data.expires_in),
    scopes: data.scope ?? "",
  };
}

/** Get a fresh access token for a service_connections row. */
export async function getFreshServiceToken(conn: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<{ accessToken: string; expiresAt: Date; scopes: string } | null> {
  if (conn.expiresAt.getTime() > Date.now()) {
    return { accessToken: conn.accessToken, expiresAt: conn.expiresAt, scopes: "" };
  }
  try {
    return await refreshServiceToken(conn.refreshToken);
  } catch (err) {
    console.error("[service-connector] token refresh failed", err);
    return null;
  }
}
