import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSpotifyTrack,
  SpotifyPlayError,
} from "../src/lore/spotifyConnect.js";

vi.mock("../src/spotify/appClient.js", () => ({
  searchTrack: vi.fn(async () => null),
}));

const baseRecording = {
  title: "Go Your Own Way",
  artist: "Fleetwood Mac",
  isrc: null,
  links: null,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveSpotifyTrack with a user token", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("resolves via the listener's token search", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        tracks: {
          items: [
            {
              uri: "spotify:track:abc123",
              id: "abc123",
              duration_ms: 217000,
              external_urls: { spotify: "https://open.spotify.com/track/abc123" },
            },
          ],
        },
      }),
    ) as unknown as typeof fetch;

    const resolved = await resolveSpotifyTrack(
      { ...baseRecording, mbid: "user-token-hit-1" },
      "user-token",
    );
    expect(resolved).toEqual({
      uri: "spotify:track:abc123",
      url: "https://open.spotify.com/track/abc123",
      durationMs: 217000,
      source: "search",
    });
  });

  it("throws an honest SpotifyPlayError on upstream failure (429)", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(429, { error: "rate limited" }),
    ) as unknown as typeof fetch;

    await expect(
      resolveSpotifyTrack({ ...baseRecording, mbid: "user-token-429" }, "user-token"),
    ).rejects.toBeInstanceOf(SpotifyPlayError);
  });

  it("throws on non-429 upstream failures too (never a fake 'not found')", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(500, { error: "boom" }),
    ) as unknown as typeof fetch;

    await expect(
      resolveSpotifyTrack({ ...baseRecording, mbid: "user-token-500" }, "user-token"),
    ).rejects.toBeInstanceOf(SpotifyPlayError);
  });

  it("returns null only on a true empty-result success", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { tracks: { items: [] } }),
    ) as unknown as typeof fetch;

    const resolved = await resolveSpotifyTrack(
      { ...baseRecording, mbid: "user-token-miss" },
      "user-token",
    );
    expect(resolved).toBeNull();
  });

  it("does not reuse a user-token search result from cache for later calls", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        tracks: {
          items: [
            {
              uri: "spotify:track:cachecheck",
              id: "cachecheck",
              duration_ms: 1000,
              external_urls: {
                spotify: "https://open.spotify.com/track/cachecheck",
              },
            },
          ],
        },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const mbid = "user-token-nocache";
    await resolveSpotifyTrack({ ...baseRecording, mbid }, "user-token");
    await resolveSpotifyTrack({ ...baseRecording, mbid }, "user-token");
    // Both calls hit Spotify — market-scoped results are never cached.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
