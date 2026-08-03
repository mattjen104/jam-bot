import type {
  ConnectorTokens,
  PlaylistCreateInput,
  PlaylistCreateResult,
  PlaylistTrackInput,
  PlaylistTrackResult,
  ServiceConnector,
} from "./serviceConnector.js";

const API_BASE = process.env.TIDAL_API_BASE ?? "https://openapi.tidal.com/v2";
const AUTH_BASE = process.env.TIDAL_AUTH_BASE ?? "https://login.tidal.com/oauth2";

function configured(): boolean {
  return Boolean(process.env.TIDAL_CLIENT_ID && process.env.TIDAL_CLIENT_SECRET);
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${process.env.TIDAL_CLIENT_ID ?? ""}:${process.env.TIDAL_CLIENT_SECRET ?? ""}`).toString("base64")}`;
}

function signal(): AbortSignal {
  return AbortSignal.timeout(12_000);
}

function providerFailure(res: Response, context: string): { retryable: boolean; error: string } {
  return { retryable: res.status === 408 || res.status === 429 || res.status >= 500, error: `Tidal ${context} failed (${res.status})` };
}

export class TidalConnector implements ServiceConnector {
  readonly service = "tidal";
  readonly displayName = "Tidal";

  isConfigured(): boolean {
    return configured();
  }

  authStart(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: process.env.TIDAL_CLIENT_ID ?? "",
      response_type: "code",
      redirect_uri: redirectUri,
      scope: process.env.TIDAL_SCOPES ?? "user.read playlists.write",
      state,
    });
    return `${AUTH_BASE}/authorize?${params.toString()}`;
  }

  async authCallback(code: string, redirectUri: string): Promise<ConnectorTokens> {
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: signal(),
    });
    if (!res.ok) throw new Error(`Tidal token request failed (${res.status})`);
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      user_id?: string;
    };
    if (!body.access_token || !body.refresh_token) throw new Error("Tidal authorization returned incomplete credentials");
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000),
      scopes: body.scope ?? "playlists.write",
      canWrite: (body.scope ?? "playlists.write").split(/\s+/).includes("playlists.write"),
      externalUserId: body.user_id,
    };
  }

  async refreshToken(refreshToken: string) {
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
      signal: signal(),
    });
    if (!res.ok) throw new Error(`Tidal token refresh failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!body.access_token) throw new Error("Tidal token refresh returned no access token");
    return {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000),
      scopes: body.scope ?? "",
    };
  }

  async *importLibrary(): AsyncIterable<never> {
    return;
  }

  async addToLibrary(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async catalogHas(): Promise<boolean> {
    return false;
  }

  async createPlaylist(
    accessToken: string,
    input: PlaylistCreateInput,
  ): Promise<PlaylistCreateResult> {
    if (!input.externalUserId) return { ok: false, retryable: false, error: "Tidal account id is missing" };
    try {
      const res = await fetch(`${API_BASE}/users/${encodeURIComponent(input.externalUserId)}/playlists`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: { type: "playlists", attributes: { name: input.name, description: input.description } } }),
        signal: signal(),
      });
      if (!res.ok) {
        const failure = providerFailure(res, "playlist creation");
        return { ok: false, retryable: failure.retryable, error: failure.error };
      }
      const body = (await res.json()) as { data?: { id?: string; links?: { self?: string } } };
      const id = body.data?.id;
      if (!id) return { ok: false, retryable: false, error: "Tidal returned no playlist id" };
      return { ok: true, playlistId: id, playlistUrl: body.data?.links?.self ?? `https://tidal.com/browse/playlist/${encodeURIComponent(id)}`, retryable: false };
    } catch (err) {
      return { ok: false, retryable: true, error: err instanceof Error ? err.message : "Tidal network error" };
    }
  }

  async addPlaylistTracks(
    accessToken: string,
    playlistId: string,
    tracks: PlaylistTrackInput[],
  ): Promise<PlaylistTrackResult[]> {
    const results: PlaylistTrackResult[] = [];
    for (const track of tracks) {
      try {
        const res = await fetch(`${API_BASE}/playlists/${encodeURIComponent(playlistId)}/relationships/items`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ data: [{ type: "tracks", id: track.externalId }] }),
          signal: signal(),
        });
        if (res.ok) results.push({ position: track.position, status: "accepted", retryable: false });
        else {
          const failure = providerFailure(res, `track ${track.position + 1}`);
          results.push({ position: track.position, status: failure.retryable ? "rejected" : "missing", retryable: failure.retryable, error: failure.error });
        }
      } catch (err) {
        results.push({ position: track.position, status: "rejected", retryable: true, error: err instanceof Error ? err.message : "Tidal network error" });
      }
    }
    return results;
  }
}