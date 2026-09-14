// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { DialStation } from "../src/hooks/useDialData";
import type { LibraryItem } from "../src/lib/meHooks";

const {
  toggleRadio,
  warmup,
  releaseWarmup,
  cancelWarmup,
  togglePreview,
  playerState,
} = vi.hoisted(() => ({
  toggleRadio: vi.fn(),
  warmup: vi.fn(),
  releaseWarmup: vi.fn(),
  cancelWarmup: vi.fn(),
  togglePreview: vi.fn(async () => "playing" as const),
  playerState: {
    station: null as { slug: string } | null,
    playingMbid: null as string | null,
    loadingMbid: null as string | null,
  },
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({
    radio: {
      station: playerState.station,
      toggle: toggleRadio,
      warmup,
      releaseWarmup,
      cancelWarmup,
    },
  }),
}));

vi.mock("../src/player/inlinePreview", () => ({
  useInlinePreview: () => ({
    playingMbid: playerState.playingMbid,
    loadingMbid: playerState.loadingMbid,
    toggle: togglePreview,
    stop: vi.fn(),
  }),
}));

vi.mock("../src/hooks/use-toast", () => ({ toast: vi.fn() }));

import {
  DemoSongRemote,
  DemoStationRemote,
} from "../src/components/DemoLibraryRemote";

function dialStation(
  slug: string,
  name: string,
  crossings: number,
  options: {
    logoUrl?: string | null;
    isLive?: boolean;
    genres?: string[];
    releaseYear?: number | null;
  } = {},
): DialStation {
  return {
    station: {
      id: crossings + 1,
      slug,
      name,
      city: "Somewhere",
      streamUrl: `https://radio.example/${slug}`,
      logoUrl: options.logoUrl ?? null,
    },
    isLive: options.isLive ?? false,
    liveTrack: options.genres || options.releaseYear
      ? {
          title: "A long-running broadcast selection",
          artist: "A known artist",
          genres: options.genres ?? null,
          releaseYear: options.releaseYear ?? null,
        }
      : null,
    shows: [],
    lifetimeCrossings: crossings,
    lifetimeArtistCrossings: 0,
    topArtistNames: [],
    topArtistNames24h: [],
    topArtistNames7d: [],
    topArtistNamesLifetime: [],
    albumCrossings: [],
  } as unknown as DialStation;
}

function libraryItem(
  mbid: string | null,
  title: string,
  artist: string,
  addedAt: string,
  artworkUrl: string | null = null,
  metadata: { genres?: string[]; releaseYear?: number | null } = {},
): LibraryItem {
  return {
    mbid,
    spotifyId: mbid ? null : `spotify-${title}`,
    addedAt,
    provenance: { kind: "keep" },
    recording: {
      title,
      artist,
      artistMbid: null,
      albumTitle: "An album",
      releaseGroupMbid: null,
      artworkUrl,
      spotifyUrl: null,
      genres: metadata.genres ?? null,
      releaseYear: metadata.releaseYear ?? null,
    },
  };
}

beforeEach(() => {
  toggleRadio.mockClear();
  warmup.mockClear();
  releaseWarmup.mockClear();
  cancelWarmup.mockClear();
  togglePreview.mockClear();
  playerState.station = null;
  playerState.playingMbid = null;
  playerState.loadingMbid = null;
});

afterEach(cleanup);

describe("demo Library visual remotes", () => {
  test("uses list ordering and the existing warmup/tune controls for stations", () => {
    const rare = dialStation("kexp", "KEXP", 1);
    const frequent = dialStation("kcrw", "KCRW", 8);
    render(
      <DemoStationRemote
        stations={[rare, frequent]}
        hasData
        focusedArtist={null}
        sort="overlap"
      />,
    );

    const tiles = screen.getAllByTestId("demo-station-remote-tile");
    expect(tiles[0]?.getAttribute("aria-label")).toContain("KCRW");
    expect(tiles[1]?.getAttribute("aria-label")).toContain("KEXP");

    fireEvent.pointerDown(tiles[0]!);
    fireEvent.pointerUp(tiles[0]!);
    fireEvent.click(tiles[0]!);
    expect(warmup).toHaveBeenCalledWith(frequent.station);
    expect(releaseWarmup).toHaveBeenCalledOnce();
    expect(toggleRadio).toHaveBeenCalledWith(frequent.station);
  });

  test("shows city and specialist subtype instead of crossing copy", () => {
    const station = dialStation("jazz", "Jazz FM", 4);
    station.station.city = "London";
    station.station.tags = ["jazz"];
    station.station.stationCategories = ["specialist"];
    render(
      <DemoStationRemote
        stations={[station]}
        hasData
        focusedArtist={null}
        sort="overlap"
      />,
    );

    expect(screen.getByText("London · Jazz / Blues")).toBeTruthy();
    expect(screen.queryByText(/crossings?/i)).toBeNull();
  });

  test("shows station initials when a logo is missing and marks the tuned tile", () => {
    playerState.station = { slug: "kexp" };
    render(
      <DemoStationRemote
        stations={[dialStation("kexp", "KEXP 90.3 FM", 2)]}
        hasData
        focusedArtist={null}
        sort="overlap"
      />,
    );

    const tile = screen.getByTestId("demo-station-remote-tile");
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(tile.querySelector('[data-station-mark="fallback"]')).toBeTruthy();
    expect(tile.textContent).toContain("KEXP");
  });

  test("sorts songs for the remote and uses shared inline preview playback", () => {
    const newer = libraryItem("track-z", "Zebra", "Beta", "2026-09-09T00:00:00Z");
    const older = libraryItem("track-a", "Alpha", "Gamma", "2026-09-08T00:00:00Z");
    render(<DemoSongRemote items={[newer, older]} sort="title" />);

    const tiles = screen.getAllByTestId("demo-song-remote-tile");
    expect(tiles[0]?.getAttribute("aria-label")).toContain("Alpha");
    expect(tiles[0]?.textContent).toContain("Alpha");
    fireEvent.click(tiles[0]!);
    expect(togglePreview).toHaveBeenCalledWith("track-a");
  });

  test("marks preview playback and disables unresolved songs", () => {
    playerState.playingMbid = "playing-track";
    const playable = libraryItem(
      "playing-track",
      "Playing Song",
      "Artist",
      "2026-09-09T00:00:00Z",
      "https://example.com/art.jpg",
    );
    const unresolved = libraryItem(
      null,
      "Unresolved Song",
      "Artist",
      "2026-09-08T00:00:00Z",
    );
    render(<DemoSongRemote items={[playable, unresolved]} sort="added" />);

    expect(screen.getByRole("button", { name: "Stop preview of Playing Song by Artist" })
      .getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", {
      name: "Preview Unresolved Song by Artist",
    }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows combined known filter evidence and omits explanations for unknown metadata", () => {
    const filters = {
      genres: ["experimental", "electronic"],
      ages: ["deep" as const],
      decade: 1990,
    };
    const knownStation = dialStation("known", "Known FM", 2, {
      genres: ["experimental", "electronic"],
      releaseYear: 1996,
    });
    const unknownStation = dialStation("unknown", "Unknown FM", 1);
    const { rerender } = render(
      <DemoStationRemote
        stations={[knownStation, unknownStation]}
        hasData
        focusedArtist={null}
        sort="overlap"
        matchFilters={filters}
      />,
    );

    const stationTiles = screen.getAllByTestId("demo-station-remote-tile");
    // Station tiles no longer show now-playing-derived metadata matches
    expect(stationTiles[0]?.textContent).not.toContain("Matches");
    expect(stationTiles[1]?.textContent).not.toContain("Matches");

    playerState.playingMbid = "known-song";
    rerender(
      <DemoSongRemote
        items={[
          libraryItem("known-song", "Known Song", "Known Artist", "2026-09-09T00:00:00Z", null, {
            genres: ["experimental", "electronic"],
            releaseYear: 1996,
          }),
          libraryItem("unknown-song", "Unknown Song", "Unknown Artist", "2026-09-08T00:00:00Z"),
        ]}
        sort="added"
        matchFilters={filters}
      />,
    );

    const inspector = screen.getByRole("complementary");
    expect(inspector.textContent).toContain("Matches Experimental, Electronic, 1990s");
    const songTiles = screen.getAllByTestId("demo-song-remote-tile");
    expect(songTiles[0]?.querySelector(".demo-library-remote__match-dot")).toBeTruthy();
    expect(songTiles[1]?.querySelector(".demo-library-remote__match-dot")).toBeNull();
  });

  test("turns a failed preview into an honest unavailable control", async () => {
    togglePreview.mockResolvedValueOnce("unavailable");
    render(
      <DemoSongRemote
        items={[libraryItem(
          "missing-preview",
          "Silent Song",
          "Artist",
          "2026-09-09T00:00:00Z",
        )]}
        sort="added"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview Silent Song by Artist" }));

    await waitFor(() => {
      const unavailable = screen.getByRole("button", {
        name: "Preview unavailable for Silent Song by Artist",
      }) as HTMLButtonElement;
      expect(unavailable.disabled).toBe(true);
      expect(unavailable.title).toContain("Preview unavailable");
    });
  });

  test("uses the shared mission explanation and verified live context", () => {
    const mission = dialStation("wfmu", "WFMU", 0);
    mission.station.automationClass = "human";
    mission.shows = [{
      state: "live",
      showName: "Give the Drummer Radio",
      djName: "Doug Schulkind",
      spins: [],
    }] as DialStation["shows"];
    render(
      <DemoStationRemote
        stations={[mission]}
        hasData
        focusedArtist={null}
        sort="overlap"
      />,
    );
    expect(screen.getByText("Beyond your Library")).toBeTruthy();
    expect(screen.getByRole("complementary").textContent)
      .toContain("Listener-supported freeform radio");
    expect(screen.getByRole("complementary").textContent)
      .toContain("Give the Drummer Radio · Doug Schulkind");
  });
});