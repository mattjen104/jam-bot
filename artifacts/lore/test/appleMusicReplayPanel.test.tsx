// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppleMusicReplayMaterialization } from "@workspace/api-client-react";
import { AppleMusicReplayPanel } from "../src/components/AppleMusicReplayPanel";
import type { MusicKitInstance } from "../src/lib/appleMusicReplay";

const receipt: AppleMusicReplayMaterialization = {
  configured: true,
  developerToken: "short-lived-token",
  appName: "Lore",
  apiBase: "https://api.music.apple.com",
  storefront: "us",
  replayId: 7,
  entries: [
    {
      position: 0,
      spinId: 10,
      recordingMbid: "first",
      rawArtist: "First artist",
      rawTitle: "First title",
      title: "First title",
      artist: "First artist",
      appleMusicId: "100",
      url: "https://music.apple.com/us/song/first/100",
      status: "available",
      reason: null,
    },
    {
      position: 1,
      spinId: 11,
      recordingMbid: null,
      rawArtist: "Unknown",
      rawTitle: "Unknown",
      title: "Unknown",
      artist: "Unknown",
      appleMusicId: null,
      url: null,
      status: "unresolved",
      reason: "unresolved",
    },
    {
      position: 2,
      spinId: 12,
      recordingMbid: "last",
      rawArtist: "Last artist",
      rawTitle: "Last title",
      title: "Last title",
      artist: "Last artist",
      appleMusicId: "300",
      url: "https://music.apple.com/us/song/last/300",
      status: "available",
      reason: null,
    },
  ],
  coverage: { total: 3, available: 2, unavailable: 0, unresolved: 1, dead: 0 },
};

function fakeMusicKit(options: { authorize?: () => Promise<unknown> } = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const music: MusicKitInstance = {
    authorize: options.authorize ?? (async () => ({})),
    setQueue: vi.fn(async () => ({})),
    play: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    addEventListener: vi.fn((event, listener) => listeners.set(event, listener)),
    removeEventListener: vi.fn((event) => listeners.delete(event)),
    skipToNextItem: vi.fn(async () => ({})),
    skipToPreviousItem: vi.fn(async () => ({})),
  };
  return {
    music,
    emit(event: string, payload: unknown) {
      listeners.get(event)?.(payload);
    },
  };
}

afterEach(() => {
  cleanup();
  delete window.MusicKit;
});

describe("AppleMusicReplayPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authorizes, queues exact IDs in order, progresses on track end, and tears down", async () => {
    const fake = fakeMusicKit();
    window.MusicKit = {
      configure: vi.fn(),
      getInstance: () => fake.music,
      Events: {
        mediaItemDidChange: "mediaItemDidChange",
        playbackStateDidChange: "playbackStateDidChange",
        authorizationStatusDidChange: "authorizationStatusDidChange",
        playbackError: "playbackError",
      },
    };
    render(<AppleMusicReplayPanel materialization={receipt} />);

    fireEvent.click(screen.getByTestId("apple-music-start"));
    await waitFor(() => expect(fake.music.setQueue).toHaveBeenCalledWith({ songs: ["100", "300"] }));
    expect(fake.music.play).toHaveBeenCalled();
    expect(screen.getByTestId("apple-music-status").textContent).toMatch(/Playing/i);

    fake.emit("mediaItemDidChange", { item: { id: "100" } });
    fake.emit("playbackStateDidChange", { state: "ended" });
    await waitFor(() =>
      expect(screen.getByText(/manifest position 3/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByTestId("apple-music-close"));
    await waitFor(() =>
      expect(fake.music.setQueue).toHaveBeenLastCalledWith({ songs: [] }),
    );
    expect(screen.queryByTestId("apple-music-close")).toBeNull();
  });

  it("keeps unavailable positions visible and reports authorization cancellation", async () => {
    const fake = fakeMusicKit({
      authorize: async () => {
        throw new Error("User cancelled authorization");
      },
    });
    window.MusicKit = {
      configure: vi.fn(),
      getInstance: () => fake.music,
    };
    render(<AppleMusicReplayPanel materialization={receipt} />);

    expect(screen.getByTestId("apple-music-entry-1").textContent).toContain("unresolved");
    fireEvent.click(screen.getByTestId("apple-music-start"));
    await waitFor(() =>
      expect(screen.getByTestId("apple-music-error").textContent).toMatch(/cancelled/i),
    );
  });

  it("shows a disabled fallback state when configuration is absent", () => {
    render(
      <AppleMusicReplayPanel
        materialization={{
          ...receipt,
          configured: false,
          developerToken: null,
        }}
      />,
    );
    expect((screen.getByTestId("apple-music-start") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("apple-music-unconfigured")).toBeTruthy();
  });
});