// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlbumProviderPlayback } from "../src/components/AlbumProviderPlayback";

const spotifyMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  loadSdk: vi.fn(),
  playAlbum: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  spotifyPlayAlbum: spotifyMocks.playAlbum,
}));

vi.mock("../src/lib/spotifyWebPlayback", () => ({
  getSpotifyPlaybackToken: spotifyMocks.getToken,
  loadSpotifyWebPlaybackSdk: spotifyMocks.loadSdk,
  subscribeSpotifyPlayer: (
    player: { addListener: (event: string, listener: (value: unknown) => void) => void },
    event: string,
    listener: (value: unknown) => void,
  ) => {
    player.addListener(event, listener);
    return () => {};
  },
}));

vi.mock("../src/components/AppleMusicReplayPanel", () => ({
  AppleMusicReplayPanel: ({ materialization }: { materialization: { entries: Array<{ appleMusicId: string | null }> } }) => (
    <div data-testid="apple-queue">{materialization.entries.map((entry) => entry.appleMusicId ?? "missing").join(",")}</div>
  ),
}));

afterEach(cleanup);
beforeEach(() => {
  spotifyMocks.getToken.mockReset();
  spotifyMocks.loadSdk.mockReset();
  spotifyMocks.playAlbum.mockReset();
});

const providers = {
  spotify: { capability: "embed" as const, embedUrl: "https://open.spotify.com/embed/album/1", externalUrl: "https://open.spotify.com/album/1" },
  bandcamp: { capability: "embed" as const, embedUrl: "https://bandcamp.com/EmbeddedPlayer/album=1", externalUrl: "https://bandcamp.com/album/1" },
  appleMusic: {
    capability: "full_authenticated_playback" as const,
    tracks: [
      { recordingMbid: "one", providerTrackId: "a", providerTrackUrl: "https://music.apple.com/a", position: 0 },
      { recordingMbid: "two", providerTrackId: "b", providerTrackUrl: "https://music.apple.com/b", position: 1 },
    ],
  },
  qobuz: { capability: "external_only" as const, externalUrl: "https://qobuz.com/album/1" },
};

const fullSpotifyProviders = {
  ...providers,
  spotify: {
    ...providers.spotify,
    capability: "full_authenticated_playback" as const,
  },
};

const unavailableProviders = {
  spotify: { capability: "unavailable" as const, reason: "Unavailable" },
  appleMusic: { capability: "unavailable" as const, reason: "Unavailable" },
  bandcamp: { capability: "unavailable" as const, reason: "Unavailable" },
  qobuz: { capability: "unavailable" as const, reason: "Unavailable" },
};

function spotifyPlayerHarness() {
  const listeners = new Map<string, (value: unknown) => void>();
  const disconnect = vi.fn();
  const pauseMock = vi.fn(async () => {});
  class Player {
    private readonly options: { getOAuthToken: (callback: (token: string) => void) => void };
    constructor(options: { getOAuthToken: (callback: (token: string) => void) => void }) {
      this.options = options;
    }
    addListener(event: string, listener: (value: unknown) => void) {
      listeners.set(event, listener);
    }
    async connect() {
      await new Promise<void>((resolve) => this.options.getOAuthToken(() => resolve()));
      listeners.get("ready")?.({ device_id: "browser-device" });
      return true;
    }
    disconnect = disconnect;
    pause = pauseMock;
    resume = vi.fn(async () => {});
    previousTrack = vi.fn(async () => {});
    nextTrack = vi.fn(async () => {});
  }
  return { Player, disconnect, pause: pauseMock };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AlbumProviderPlayback", () => {
  it("keeps one active surface and tears down an iframe when switching", async () => {
    render(<AlbumProviderPlayback providerPlayback={providers} releaseGroupMbid="release-group" appleMusicConfig={{ configured: true, developerToken: "token", appName: "Lore", storefront: "us" }} />);
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    expect(screen.getByTestId("provider-iframe-spotify")).toBeTruthy();
    fireEvent.click(screen.getByTestId("provider-action-bandcamp"));
    expect(screen.queryByTestId("provider-iframe-spotify")).toBeNull();
    expect(screen.getByTestId("provider-iframe-bandcamp")).toBeTruthy();
  });

  it("returns focus to the activating trigger after close", async () => {
    render(<AlbumProviderPlayback providerPlayback={providers} releaseGroupMbid="release-group" />);
    const trigger = screen.getByTestId("provider-action-spotify");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId("provider-playback-close"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps Qobuz external-only and preserves Apple exact order", () => {
    render(<AlbumProviderPlayback providerPlayback={providers} releaseGroupMbid="release-group" appleMusicConfig={{ configured: true, developerToken: "token", appName: "Lore", storefront: "us" }} />);
    fireEvent.click(screen.getByTestId("provider-action-qobuz"));
    expect(screen.queryByRole("iframe")).toBeNull();
    expect(screen.getByTestId("provider-external-qobuz").getAttribute("href")).toBe(providers.qobuz.externalUrl);
    fireEvent.click(screen.getByTestId("provider-action-appleMusic"));
    expect(screen.getByTestId("apple-queue").textContent).toContain("a,b");
  });

  it("creates a Spotify browser device only after the explicit start action", async () => {
    const { Player, disconnect, pause } = spotifyPlayerHarness();
    spotifyMocks.getToken.mockResolvedValue("short-lived-token");
    spotifyMocks.loadSdk.mockResolvedValue(Player);
    spotifyMocks.playAlbum.mockResolvedValue({ accepted: true });

    render(<AlbumProviderPlayback providerPlayback={fullSpotifyProviders} releaseGroupMbid="release-group" />);
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    expect(spotifyMocks.loadSdk).not.toHaveBeenCalled();
    expect(spotifyMocks.getToken).not.toHaveBeenCalled();
    expect(spotifyMocks.playAlbum).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("spotify-start"));
    await waitFor(() => expect(spotifyMocks.playAlbum).toHaveBeenCalledWith({
      releaseGroupMbid: "release-group",
      deviceId: "browser-device",
    }));
    expect(spotifyMocks.getToken).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("provider-playback-close"));
    await waitFor(() => {
      expect(pause).toHaveBeenCalledOnce();
      expect(disconnect).toHaveBeenCalledOnce();
    });
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(disconnect.mock.invocationCallOrder[0]);
  });

  it("falls back to the verified Spotify embed when the SDK fails", async () => {
    spotifyMocks.loadSdk.mockRejectedValue(new Error("SDK unavailable"));
    render(<AlbumProviderPlayback providerPlayback={fullSpotifyProviders} releaseGroupMbid="release-group" />);
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    fireEvent.click(screen.getByTestId("spotify-start"));
    expect((await screen.findByTestId("spotify-error")).textContent).toContain("SDK unavailable");
    expect(screen.getByTestId("provider-iframe-spotify")).toBeTruthy();
  });

  it("does not create a Spotify player if the surface closes while the SDK loads", async () => {
    const sdk = deferred<ReturnType<typeof spotifyPlayerHarness>["Player"]>();
    const { Player } = spotifyPlayerHarness();
    spotifyMocks.loadSdk.mockReturnValue(sdk.promise);
    render(<AlbumProviderPlayback providerPlayback={fullSpotifyProviders} releaseGroupMbid="release-group" />);
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    fireEvent.click(screen.getByTestId("spotify-start"));
    fireEvent.click(screen.getByTestId("provider-playback-close"));
    sdk.resolve(Player);
    await sdk.promise;
    await Promise.resolve();
    expect(spotifyMocks.getToken).not.toHaveBeenCalled();
    expect(spotifyMocks.playAlbum).not.toHaveBeenCalled();
  });

  it("does not start an album if the surface closes while the token is pending", async () => {
    const token = deferred<string>();
    const { Player, disconnect } = spotifyPlayerHarness();
    spotifyMocks.getToken.mockReturnValue(token.promise);
    spotifyMocks.loadSdk.mockResolvedValue(Player);
    render(<AlbumProviderPlayback providerPlayback={fullSpotifyProviders} releaseGroupMbid="release-group" />);
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    fireEvent.click(screen.getByTestId("spotify-start"));
    await waitFor(() => expect(spotifyMocks.getToken).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId("provider-playback-close"));
    token.resolve("late-token");
    await token.promise;
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
    expect(spotifyMocks.playAlbum).not.toHaveBeenCalled();
  });

  it("keeps validated external links while inline mappings are unavailable", () => {
    render(
      <AlbumProviderPlayback
        providerPlayback={unavailableProviders}
        fallbackExternalLinks={{
          spotify: "https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC",
          bandcamp: "https://artist.bandcamp.com/album/exact-release",
          qobuz: "https://evil.example/album/not-allowed",
        }}
      />,
    );
    expect(screen.getByTestId("provider-action-spotify").textContent).toContain("Open in Spotify");
    fireEvent.click(screen.getByTestId("provider-action-spotify"));
    expect(screen.getByTestId("provider-fallback-spotify").getAttribute("href"))
      .toContain("open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC");
    expect(screen.queryByTestId("provider-action-qobuz")).toBeNull();
  });
});