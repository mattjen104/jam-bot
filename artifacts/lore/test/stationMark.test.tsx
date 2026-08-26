// @vitest-environment jsdom
/**
 * Station identity marks (Station.logoUrl) on listener-facing now-playing
 * surfaces.
 *
 * Covers:
 *  - StationMark unit behaviour: proxied lazy image for valid http(s) logos,
 *    neutral fallback for missing/invalid/failed URLs, never album artwork.
 *  - Compact Feed/Dial row: the mark sits beside the station name.
 *  - /player On Air row: the cube mark accompanies the station context.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("../src/hooks/useDialData", () => ({ useDialData: vi.fn() }));
vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: null })),
    useMyGhostMissed: vi.fn(() => ({ data: null })),
    useSpotifyLibraryConnected: vi.fn(() => false),
    startSpotifyLibraryConnect: vi.fn(),
  });
});
vi.mock("../src/components/StationLane", () => ({ StationLane: () => <div /> }));
vi.mock("../src/components/ContextRail", () => ({ ContextRail: () => <div /> }));
vi.mock("../src/components/SearchOverlay", () => ({ SearchOverlay: () => <div /> }));
vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({
      radio: { station: null, status: "idle", toggle: vi.fn() },
      ride: { active: false },
      spotify: { connected: false },
      scan: { active: false, toggle: vi.fn() },
    })),
  });
});
vi.mock("../src/lib/social", () => ({
  useSocialMode: vi.fn(() => ({ enabled: false })),
}));

import { StationMark } from "../src/components/StationMark";
import { FrontDoorRow } from "../src/components/DialView";
import type { DialShow, DialStation } from "../src/hooks/useDialData";
import { OnAirRow } from "../src/webplayer/WebPlayer";
import type { WpOnAirItem } from "../src/webplayer/hooks";

const LOGO = "https://static.example.com/kexp-logo.png";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("StationMark", () => {
  it("renders the station logo through the art proxy, lazy and decorative", () => {
    const { container } = render(<StationMark name="KEXP" logoUrl={LOGO} />);
    const img = container.querySelector("img[data-station-mark='logo']");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(`/api/art?src=${encodeURIComponent(LOGO)}`);
    expect(img!.getAttribute("loading")).toBe("lazy");
    expect(img!.getAttribute("decoding")).toBe("async");
    expect(img!.getAttribute("alt")).toBe("");
    expect(img!.getAttribute("aria-hidden")).toBe("true");
  });

  it("accepts plain-http logos (the proxy upgrades mixed content)", () => {
    const { container } = render(
      <StationMark name="KEXP" logoUrl="http://static.example.com/logo.png" />,
    );
    expect(container.querySelector("img[data-station-mark='logo']")).not.toBeNull();
  });

  it("falls back to a neutral mark when no logo URL exists", () => {
    const { container } = render(<StationMark name="KEXP" logoUrl={null} />);
    expect(container.querySelector("[data-station-mark='fallback']")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses a proxied homepage favicon when the station has no logo URL", () => {
    const { container } = render(
      <StationMark name="KEXP" logoUrl={null} homepageUrl="https://kexp.org/schedule/" />,
    );
    const img = container.querySelector("img[data-station-mark='logo']");
    const favicon = "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fkexp.org";
    expect(img?.getAttribute("src")).toBe(`/api/art?src=${encodeURIComponent(favicon)}`);
  });

  it("rejects non-http(s) URLs instead of rendering them", () => {
    const { container } = render(
      <StationMark name="KEXP" logoUrl="javascript:alert(1)" />,
    );
    expect(container.querySelector("[data-station-mark='fallback']")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("swaps to the neutral mark when the image fails to load", () => {
    const { container } = render(<StationMark name="KEXP" logoUrl={LOGO} />);
    const img = container.querySelector("img[data-station-mark='logo']")!;
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("[data-station-mark='fallback']")).not.toBeNull();
  });

  it("retries when a different logo URL arrives after a failure", () => {
    const { container, rerender } = render(<StationMark name="KEXP" logoUrl={LOGO} />);
    fireEvent.error(container.querySelector("img[data-station-mark='logo']")!);
    expect(container.querySelector("img")).toBeNull();
    rerender(<StationMark name="KEXP" logoUrl="https://static.example.com/new.png" />);
    expect(container.querySelector("img[data-station-mark='logo']")).not.toBeNull();
  });

  it("uses the homepage favicon after an explicit logo fails", () => {
    const { container } = render(
      <StationMark name="KEXP" logoUrl={LOGO} homepageUrl="https://kexp.org" />,
    );
    fireEvent.error(container.querySelector("img[data-station-mark='logo']")!);
    const fallback = "https://www.google.com/s2/favicons?sz=128&domain_url=https%3A%2F%2Fkexp.org";
    expect(container.querySelector("img[data-station-mark='logo']")?.getAttribute("src")).toBe(
      `/api/art?src=${encodeURIComponent(fallback)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Compact Feed / Dial row
// ---------------------------------------------------------------------------

function makeDialStation(stationOverrides: Record<string, unknown> = {}): DialStation {
  return {
    station: {
      slug: "kexp",
      name: "KEXP",
      streamUrl: "https://stream.example.com/live",
      logoUrl: null,
      ...stationOverrides,
    } as DialStation["station"],
    isLive: true,
    shows: [],
    crossings: 0,
    artistCrossings: 0,
    lifetimeCrossings: 0,
    lifetimeArtistCrossings: 0,
  } as DialStation;
}

function makeShow(): DialShow {
  return {
    runId: 1,
    showName: "Morning Mix",
    djName: null,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    endedAt: new Date().toISOString(),
    state: "live",
    spins: [],
    crossings: 0,
    artistCrossings: 0,
    topArtists: [],
    topArtistNames: [],
    currentTrack: null,
    isPickerShow: false,
    pickerId: null,
  } as DialShow;
}

function renderCompactRow(ds: DialStation, extra: Record<string, unknown> = {}) {
  return render(
    <FrontDoorRow
      ds={ds}
      show={makeShow()}
      ov={0}
      isActive={false}
      isSampling={false}
      onTuneIn={vi.fn()}
      compactSentence
      {...extra}
    />,
  );
}

describe("compact Feed row station mark", () => {
  it("shows the station logo beside the station name when logoUrl is available", () => {
    const { container } = renderCompactRow(makeDialStation({ logoUrl: LOGO }));
    const right = container.querySelector(".fdrow__compact-right");
    expect(right?.querySelector("img[data-station-mark='logo']")).not.toBeNull();
    expect(right?.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
  });

  it("keeps the station name visible with a neutral mark when no logo exists", () => {
    const { container } = renderCompactRow(makeDialStation());
    const right = container.querySelector(".fdrow__compact-right");
    expect(right?.querySelector("[data-station-mark='fallback']")).not.toBeNull();
    expect(right?.querySelector(".fdrow__compact-station")?.textContent).toBe("KEXP");
  });

  it("never uses track artwork as the station mark", () => {
    const artwork = "https://images.example.com/album-cover.jpg";
    const { container } = renderCompactRow(makeDialStation(), {
      isActive: true,
      artworkUrl: artwork,
    });
    // The station mark falls back to neutral — artwork stays on the row's
    // art-fade only.
    expect(container.querySelector(".fdrow__compact-right img")).toBeNull();
    expect(
      container.querySelector(".fdrow__compact-right [data-station-mark='fallback']"),
    ).not.toBeNull();
    const fade = container.querySelector(".fdrow__art-fade") as HTMLElement;
    expect(fade?.style.backgroundImage).toContain(encodeURIComponent(artwork));
  });
});

// ---------------------------------------------------------------------------
// /player On Air row
// ---------------------------------------------------------------------------

function makeOnAirItem(logoUrl: string | null): WpOnAirItem {
  return {
    station: {
      id: 1,
      slug: "kexp",
      name: "KEXP",
      homepageUrl: null,
      streamUrl: "https://stream.example.com/live",
      logoUrl,
    } as unknown as WpOnAirItem["station"],
    show: null,
    now: {
      mbid: "abc-123",
      title: "Go Your Own Way",
      artist: "Fleetwood Mac",
      artworkUrl: "https://images.example.com/rumours.jpg",
      playedAt: new Date().toISOString(),
      resolved: true,
    },
    earlier: [],
    matchCount: null,
  };
}

describe("On Air row station mark", () => {
  it("presents the station logo as a cube beside the station context", () => {
    const { container } = render(
      <OnAirRow
        item={makeOnAirItem(LOGO)}
        authenticated={false}
        nowInLibrary={false}
        onOpenRun={() => {}}
      />,
    );
    const img = container.querySelector("img[data-station-mark='logo']");
    expect(img).not.toBeNull();
    expect(img!.className).toContain("station-mark--cube");
    // The row's track artwork is never borrowed for the station mark.
    expect(img!.getAttribute("src")).not.toContain("rumours");
  });

  it("keeps the station name visible with a neutral mark when no logo exists", () => {
    const { container } = render(
      <OnAirRow
        item={makeOnAirItem(null)}
        authenticated={false}
        nowInLibrary={false}
        onOpenRun={() => {}}
      />,
    );
    expect(container.querySelector("[data-station-mark='fallback']")).not.toBeNull();
    expect(container.textContent).toContain("KEXP");
  });
});
