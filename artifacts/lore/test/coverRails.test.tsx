// @vitest-environment jsdom
/**
 * Cover-rail tests — the Explore music-object grammar (cover leads, station
 * is provenance) vs the station-destination grammar (station leads).
 *
 * Covers: exact crossing art, album-crossing art via CAA fallback,
 * artist-only crossings staying text-only, resolving tracks excluded,
 * missing artwork quiet fallback, bounded rails, action split (record link
 * vs Tune in vs Preview), accessibility labels, and first-play labelling.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import {
  LiveCrossingCoverRail,
  FirstPlayCoverRail,
  crossingCoverItems,
  crossingArtworkFor,
  CROSSING_COVER_LIMIT,
  FIRST_PLAY_LIMIT,
} from "../src/components/dial/CoverRails";
import type { DialLaneRow } from "../src/components/dial/DialFeedLane";
import { makeDialSpin, makeDialStation } from "./helpers/dialDataMock";

const startReplay = vi.fn();
vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: () => ({ ride: { startReplay } }),
}));

function makeRow(overrides: {
  slug?: string;
  name?: string;
  isLive?: boolean;
  track?: Parameters<typeof makeDialSpin>[0] | null;
  albumCrossings?: ReturnType<typeof makeDialStation>["albumCrossings"];
}): DialLaneRow {
  const track = overrides.track === undefined
    ? makeDialSpin({
        mbid: "rec-1",
        title: "Crossed Song",
        artist: "Crossed Artist",
        isLibraryHit: true,
        releaseGroupMbid: "rg-1",
      })
    : overrides.track;
  const ds = makeDialStation({
    station: { slug: overrides.slug ?? "kexp", name: overrides.name ?? "KEXP" } as never,
    isLive: overrides.isLive ?? true,
    liveTrack: track,
    albumCrossings: overrides.albumCrossings ?? [],
  });
  return { ds, show: null, effectiveDjName: null };
}

const ALBUM_CROSSING = {
  releaseGroupMbid: "rg-1",
  recordingMbid: "rec-1",
  title: "Crossed Album",
  artist: "Crossed Artist",
  artworkUrl: "https://i.scdn.co/image/exact-cover",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("crossingCoverItems", () => {
  it("includes a confirmed live exact crossing with album-crossing artwork", () => {
    const row = makeRow({ albumCrossings: [ALBUM_CROSSING] });
    const items = crossingCoverItems([row]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      stationName: "KEXP",
      artist: "Crossed Artist",
      title: "Crossed Song",
      artworkUrl: "https://i.scdn.co/image/exact-cover",
      detailHref: "/album/rg-1",
    });
  });

  it("derives release-exact CAA art from the release-group MBID when the album crossing has no stored art", () => {
    const row = makeRow({ albumCrossings: [{ ...ALBUM_CROSSING, artworkUrl: null }] });
    const items = crossingCoverItems([row]);
    expect(items).toHaveLength(1);
    expect(items[0].artworkUrl).toBe(
      "https://coverartarchive.org/release-group/rg-1/front-500",
    );
  });

  it("matches album-level crossings by release-group even when the recording MBID differs", () => {
    const row = makeRow({
      track: makeDialSpin({
        mbid: "rec-other",
        releaseGroupMbid: "rg-1",
        isLibraryHit: true,
      }),
      albumCrossings: [ALBUM_CROSSING],
    });
    expect(crossingArtworkFor(row.ds, row.ds.liveTrack!)?.artworkUrl).toBe(
      "https://i.scdn.co/image/exact-cover",
    );
  });

  it("includes artist crossings when the playing release has exact identity", () => {
    const row = makeRow({
      track: makeDialSpin({ isLibraryHit: false, isArtistHit: true, releaseGroupMbid: "rg-1" }),
      albumCrossings: [ALBUM_CROSSING],
    });
    expect(crossingCoverItems([row])).toEqual([
      expect.objectContaining({ matchKind: "artist", artworkUrl: ALBUM_CROSSING.artworkUrl }),
    ]);
  });

  it("excludes provisional (resolving) tracks", () => {
    const row = makeRow({
      track: makeDialSpin({ isLibraryHit: true, releaseGroupMbid: "rg-1", resolving: true }),
      albumCrossings: [ALBUM_CROSSING],
    });
    expect(crossingCoverItems([row])).toHaveLength(0);
  });

  it("excludes crossings without any release-exact art instead of guessing", () => {
    const row = makeRow({
      track: makeDialSpin({ isLibraryHit: true, releaseGroupMbid: null }),
      albumCrossings: [],
    });
    expect(crossingCoverItems([row])).toHaveLength(0);
  });

  it("excludes stations that are not live", () => {
    const row = makeRow({ isLive: false, albumCrossings: [ALBUM_CROSSING] });
    expect(crossingCoverItems([row])).toHaveLength(0);
  });

  it("bounds the rail to CROSSING_COVER_LIMIT cards", () => {
    const rows = Array.from({ length: CROSSING_COVER_LIMIT + 3 }, (_, i) =>
      makeRow({ slug: `st-${i}`, name: `Station ${i}`, albumCrossings: [ALBUM_CROSSING] }));
    expect(crossingCoverItems(rows)).toHaveLength(CROSSING_COVER_LIMIT);
  });
});

describe("LiveCrossingCoverRail", () => {
  it("renders a cover-led card with station provenance and a separate tune-in action", () => {
    const onTuneIn = vi.fn();
    const row = makeRow({ albumCrossings: [ALBUM_CROSSING] });
    render(<LiveCrossingCoverRail rows={[row]} onTuneIn={onTuneIn} />);

    const rail = screen.getByTestId("crossing-cover-rail");
    expect(within(rail).getByText("KEXP · record crossing")).toBeTruthy();
    expect(within(rail).getByText("Crossed Artist")).toBeTruthy();
    expect(within(rail).getByText("Crossed Song")).toBeTruthy();

    // Record action: the cover leads to the album detail surface.
    const recordLink = within(rail).getByRole("link", { name: "Open Crossed Song by Crossed Artist" });
    expect(recordLink.getAttribute("href")).toBe("/album/rg-1");
    const img = recordLink.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(
      `/api/art?src=${encodeURIComponent("https://i.scdn.co/image/exact-cover")}`,
    );
    expect(img.getAttribute("loading")).toBe("lazy");

    // Station action: a distinct button that tunes into the live broadcast.
    const tune = within(rail).getByRole("button", { name: "Tune in to KEXP" });
    fireEvent.click(tune);
    expect(onTuneIn).toHaveBeenCalledWith(row);
    expect(startReplay).not.toHaveBeenCalled();
  });

  it("renders nothing when no live crossing has trustworthy art", () => {
    const row = makeRow({
      track: makeDialSpin({ isLibraryHit: false, isArtistHit: true }),
    });
    const { container } = render(<LiveCrossingCoverRail rows={[row]} onTuneIn={vi.fn()} />);
    expect(container.querySelector("[data-testid='crossing-cover-rail']")).toBeNull();
  });
});

describe("FirstPlayCoverRail", () => {
  const firstPlay = {
    id: 7,
    mbid: "rec-fp",
    title: "New Song",
    artist: "New Artist",
    artworkUrl: "https://i.scdn.co/image/first-play",
    releaseYear: 2026,
    releaseDate: "2026-03-01",
    playedAt: new Date().toISOString(),
    station: { slug: "kexp", name: "KEXP" },
  };

  function stubFetch(items: unknown[] | null, ok = true) {
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok,
        json: () => Promise.resolve(ok ? { items: items ?? [] } : {}),
      } as Response));
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  beforeEach(() => startReplay.mockClear());

  it("labels first plays as 'First play · station' with cover art and honest actions", async () => {
    stubFetch([firstPlay]);
    const onTuneStation = vi.fn();
    render(<FirstPlayCoverRail liveSlugs={new Set(["kexp"])} onTuneStation={onTuneStation} />);

    const rail = await screen.findByTestId("first-play-cover-rail");
    expect(within(rail).getByText("New to Lore")).toBeTruthy();
    expect(within(rail).getByText(/First play · KEXP/)).toBeTruthy();
    expect(within(rail).queryByText(/Premiere/)).toBeNull();

    const recordLink = within(rail).getByRole("link", { name: "Open New Song by New Artist" });
    expect(recordLink.getAttribute("href")).toBe("/song/rec-fp");
    expect(within(rail).getByTestId("first-play-cover-art").getAttribute("src")).toBe(
      `/api/art?src=${encodeURIComponent("https://i.scdn.co/image/first-play")}`,
    );

    // Preview is exact-track replay — visually and nominally distinct from live radio.
    fireEvent.click(within(rail).getByRole("button", { name: "Preview New Artist — New Song" }));
    expect(startReplay).toHaveBeenCalledWith(
      [expect.objectContaining({ mbid: "rec-fp", artworkUrl: "https://i.scdn.co/image/first-play" })],
      "First play · KEXP",
      expect.objectContaining({ previewOnly: true }),
    );
    expect(onTuneStation).not.toHaveBeenCalled();

    // Tune in only appears because the source station is currently live.
    fireEvent.click(within(rail).getByRole("button", { name: "Tune in to KEXP" }));
    expect(onTuneStation).toHaveBeenCalledWith("kexp");
  });

  it("omits the Tune in action when the source station is not live", async () => {
    stubFetch([firstPlay]);
    render(<FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />);
    const rail = await screen.findByTestId("first-play-cover-rail");
    expect(within(rail).queryByRole("button", { name: "Tune in to KEXP" })).toBeNull();
    expect(within(rail).getByRole("button", { name: "Preview New Artist — New Song" })).toBeTruthy();
  });

  it("uses the quiet fallback treatment for missing artwork, never a guessed cover", async () => {
    stubFetch([{ ...firstPlay, artworkUrl: null }]);
    render(<FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />);
    const img = await screen.findByTestId("first-play-cover-art");
    expect(img.getAttribute("src")).toContain("rumours.jpg");
  });

  it("renders nothing when the archive read fails", async () => {
    stubFetch(null, false);
    const { container } = render(
      <FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-testid='first-play-cover-rail']")).toBeNull();
    });
  });

  it("renders nothing when there are no first plays", async () => {
    stubFetch([]);
    const { container } = render(
      <FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />,
    );
    await waitFor(() => {
      expect(container.querySelector("[data-testid='first-play-cover-rail']")).toBeNull();
    });
  });

  it("requests the exact home-fast-lane contract (limit=18&home=1) so the rail stays Lore-wide for signed-in listeners", async () => {
    const fetchSpy = stubFetch([firstPlay]);
    render(<FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />);
    await screen.findByTestId("first-play-cover-rail");
    // The server only serves the public, release-qualified home read (same
    // results signed-in or anonymous) for exactly limit=18 with home=1 —
    // any other limit silently personalizes/empties this rail.
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/player/history?scope=7d&filter=firstPlays&order=desc&limit=18&home=1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("bounds the rendered rail to FIRST_PLAY_LIMIT cards even when the fetch returns more", async () => {
    const many = Array.from({ length: 18 }, (_, i) => ({
      ...firstPlay,
      id: i + 1,
      mbid: `rec-fp-${i}`,
      title: `Song ${i}`,
    }));
    stubFetch(many);
    render(<FirstPlayCoverRail liveSlugs={new Set()} onTuneStation={vi.fn()} />);
    const rail = await screen.findByTestId("first-play-cover-rail");
    expect(within(rail).getAllByRole("link", { name: /^Open / })).toHaveLength(FIRST_PLAY_LIMIT);
  });
});
