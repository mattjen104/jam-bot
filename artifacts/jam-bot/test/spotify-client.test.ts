import { describe, it, expect, vi, beforeEach } from "vitest";

const mockApi = {
  refreshAccessToken: vi.fn(),
  setAccessToken: vi.fn(),
  getMyCurrentPlayingTrack: vi.fn(),
  searchTracks: vi.fn(),
  play: vi.fn(),
  addToQueue: vi.fn(),
  skipToNext: vi.fn(),
  getMyDevices: vi.fn(),
  transferMyPlayback: vi.fn(),
  getMyRecentlyPlayedTracks: vi.fn(),
  getArtist: vi.fn(),
};

vi.mock("spotify-web-api-node", () => ({
  default: function FakeSpotifyWebApi() {
    return mockApi;
  },
}));

beforeEach(() => {
  for (const fn of Object.values(mockApi)) fn.mockReset();
  mockApi.refreshAccessToken.mockResolvedValue({
    body: { access_token: "tok", expires_in: 3600 },
  });
  vi.resetModules();
});

describe("spotify client retry / refresh logic", () => {
  it("refreshes the access token before the first call", async () => {
    const { searchTrack } = await import("../src/spotify/client.js");
    mockApi.searchTracks.mockResolvedValue({ body: { tracks: { items: [] } } });
    await searchTrack("anything");
    expect(mockApi.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockApi.setAccessToken).toHaveBeenCalledWith("tok");
  });

  it("does not refresh again on the next call within the expiry window", async () => {
    const { searchTrack } = await import("../src/spotify/client.js");
    mockApi.searchTracks.mockResolvedValue({ body: { tracks: { items: [] } } });
    await searchTrack("a");
    await searchTrack("b");
    expect(mockApi.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 401 and refreshes the token", async () => {
    const { searchTrack } = await import("../src/spotify/client.js");
    mockApi.searchTracks
      .mockRejectedValueOnce({ statusCode: 401 })
      .mockResolvedValueOnce({
        body: {
          tracks: {
            items: [
              {
                id: "t1",
                uri: "spotify:track:t1",
                name: "Song",
                artists: [{ name: "Artist" }],
                album: { name: "Album" },
                duration_ms: 1234,
              },
            ],
          },
        },
      });
    const r = await searchTrack("hello");
    expect(r?.id).toBe("t1");
    expect(mockApi.searchTracks).toHaveBeenCalledTimes(2);
    expect(mockApi.refreshAccessToken).toHaveBeenCalledTimes(2);
  });

  it("retries after a 429 honoring retry-after, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const { searchTrack } = await import("../src/spotify/client.js");
      mockApi.searchTracks
        .mockRejectedValueOnce({
          statusCode: 429,
          headers: { "retry-after": "1" },
        })
        .mockResolvedValueOnce({ body: { tracks: { items: [] } } });
      const promise = searchTrack("foo");
      await vi.advanceTimersByTimeAsync(2500);
      const r = await promise;
      expect(r).toBeNull();
      expect(mockApi.searchTracks).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after 3 attempts on persistent 5xx errors", async () => {
    vi.useFakeTimers();
    try {
      const { searchTrack } = await import("../src/spotify/client.js");
      mockApi.searchTracks.mockRejectedValue({ statusCode: 503 });
      const promise = searchTrack("foo").catch((e) => e);
      await vi.advanceTimersByTimeAsync(5000);
      const err = await promise;
      expect(err).toMatchObject({ statusCode: 503 });
      expect(mockApi.searchTracks).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
