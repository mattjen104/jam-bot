import type {
  ConnectorTokens,
  PlaylistCreateInput,
  PlaylistCreateResult,
  PlaylistTrackInput,
  PlaylistTrackResult,
  ServiceConnector,
} from "./serviceConnector.js";

const API_BASE = process.env.APPLE_MUSIC_API_BASE ?? "https://api.music.apple.com/v1";
const AUTH_URL = process.env.APPLE_MUSIC_AUTH_URL ?? "";
const TOKEN_URL = process.env.APPLE_MUSIC_TOKEN_URL ?? "";

function timeoutSignal(ms = 12_000): AbortSignal {
  return AbortSignal.timeout(ms);
}

function developerToken(): string {
  return process.env.APPLE_MUSIC_DEVELOPER_TOKEN ?? "";
}

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${developerToken()}`,
    "Music-User-Token": accessToken,
    "Content-Type": "application/json",
  };
}

function resultForResponse(res: Response, context: string): { retryable: boolean; error: string } {
  return {
    retryable: res.status === 408 || res.status === 429 || res.status >= 500,
    error: `Apple Music ${context} failed (${res.status})`,
  };
}

export class AppleMusicConnector implements ServiceConnector {
  readonly service = "apple_music";
  readonly displayName = "Apple Music";

  isConfigured(): boolean {
    // Apple Music user tokens are issued by the connector authorization flow;
    // the developer token is the only provider credential needed by the API.
    return Boolean(developerToken());
  }

  authStart(state: string, redirectUri: string): string {
    if (!AUTH_URL) throw new Error("Apple Music connector authorization is not configured");
    const params = new URLSearchParams({
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      ...(process.env.APPLE_MUSIC_CLIENT_ID
        ? { client_id: process.env.APPLE_MUSIC_CLIENT_ID }
        : {}),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async authCallback(code: string, redirectUri: string): Promise<ConnectorTokens> {
    if (!TOKEN_URL) throw new Error("Apple Music token exchange is not configured");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        ...(process.env.APPLE_MUSIC_CLIENT_ID
          ? { client_id: process.env.APPLE_MUSIC_CLIENT_ID }
          : {}),
        ...(process.env.APPLE_MUSIC_CLIENT_SECRET
          ? { client_secret: process.env.APPLE_MUSIC_CLIENT_SECRET }
          : {}),
      }),
      signal: timeoutSignal(),
    });
    if (!res.ok) throw new Error(`Apple Music token request failed (${res.status})`);
    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      user_id?: string;
    };
    if (!body.access_token || !body.refresh_token) {
      throw new Error("Apple Music authorization returned incomplete credentials");
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: new Date(Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000),
      scopes: body.scope ?? "playlists.write",
      canWrite: true,
      externalUserId: body.user_id,
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
    try {
      const res = await fetch(`${API_BASE}/me/library/playlists`, {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ attributes: { name: input.name, description: input.description } }),
        signal: timeoutSignal(),
      });
      if (!res.ok) return { ok: false, retryable: resultForResponse(res, "playlist creation").retryable, error: resultForResponse(res, "playlist creation").error };
      const body = (await res.json()) as { data?: Array<{ id?: string }> };
      const id = body.data?.[0]?.id;
      if (!id) return { ok: false, retryable: false, error: "Apple Music returned no playlist id" };
      return { ok: true, playlistId: id, playlistUrl: `https://music.apple.com/library/playlist/${encodeURIComponent(id)}`, retryable: false };
    } catch (err) {
      return { ok: false, retryable: true, error: err instanceof Error ? err.message : "Apple Music network error" };
    }
  }

  async addPlaylistTracks(
    accessToken: string,
    playlistId: string,
    tracks: PlaylistTrackInput[],
  ): Promise<PlaylistTrackResult[]> {
    const results: PlaylistTrackResult[] = [];
    // One request per entry keeps the receipt position-exact even when Apple
    // rejects a single catalog id in the middle of the manifest.
    for (const track of tracks) {
      try {
        const res = await fetch(
          `${API_BASE}/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`,
          {
            method: "POST",
            headers: headers(accessToken),
            body: JSON.stringify({ data: [{ id: track.externalId, type: "songs" }] }),
            signal: timeoutSignal(),
          },
        );
        if (res.ok) results.push({ position: track.position, status: "accepted", retryable: false });
        else {
          const failure = resultForResponse(res, `track ${track.position + 1}`);
          results.push({
            position: track.position,
            status: failure.retryable ? "rejected" : "missing",
            retryable: failure.retryable,
            error: failure.error,
          });
        }
      } catch (err) {
        results.push({
          position: track.position,
          status: "rejected",
          retryable: true,
          error: err instanceof Error ? err.message : "Apple Music network error",
        });
      }
    }
    return results;
  }
}