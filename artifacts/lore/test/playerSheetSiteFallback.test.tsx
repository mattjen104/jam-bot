// @vitest-environment jsdom
/**
 * PlayerSheet attribution-only station fallback contract:
 *   - stations with no playable source show the same fixed-size icon-only
 *     site link in the expanded player sheet instead of play/pause;
 *   - the control has the same fixed 40px footprint as other sheet controls;
 *   - invalid / missing homepageUrls suppress the fallback entirely;
 *   - playable stations keep the normal sheet play button.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {});
});

// NowPlaying is hook-heavy; stub it so the sheet renders without providers.
vi.mock("../src/components/NowPlaying", () => ({
  NowPlaying: () => <div data-testid="now-playing-stub" />,
}));

import { PlayerSheet } from "../src/components/PlayerSheet";
import type { Station } from "@workspace/api-client-react";

function makeStation(overrides: Partial<Station> = {}): Station {
  return {
    id: 1,
    slug: "wvum",
    name: "WVUM",
    streamUrl: "",
    streamFormat: "mp3",
    streamQuality: null,
    mode: "live",
    homepageUrl: "https://wvum.org",
    donateUrl: null,
    logoUrl: null,
    org: null,
    city: null,
    country: null,
    attribution: false,
    tags: null,
    mayHaveAds: false,
    votes: 0,
    clickcount: 0,
    upcomingShowCount: 0,
    ...overrides,
  } as Station;
}

function renderSheet(station: Station) {
  return render(
    <PlayerSheet
      station={station}
      nowPlayingData={undefined}
      status="idle"
      volume={0.8}
      onToggle={vi.fn()}
      onStop={vi.fn()}
      onVolume={vi.fn()}
      onCollapse={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlayerSheet — attribution-only station (no stream)", () => {
  it("renders the fixed-size site link instead of play/pause", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null });
    renderSheet(station);
    expect(screen.queryByTestId("player-sheet-toggle")).toBeNull();
    const link = screen.getByTestId("player-sheet-site-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.className).toContain("player-bar-btn");
    expect(link.className).toContain("station-site-link");
    expect(link.className).toContain("player-sheet__btn");
  });

  it("site link points to the station homepageUrl in a new tab", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: "https://wvum.org" });
    renderSheet(station);
    const link = screen.getByTestId("player-sheet-site-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://wvum.org/");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("site link has accessible label identifying the station", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, name: "WVUM" });
    renderSheet(station);
    const link = screen.getByTestId("player-sheet-site-link") as HTMLAnchorElement;
    expect(link.getAttribute("aria-label")).toBe("Open WVUM site");
    expect(link.title).toBe("Open WVUM site");
  });

  it("renders nothing in the play slot when homepageUrl is absent", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: null });
    renderSheet(station);
    expect(screen.queryByTestId("player-sheet-toggle")).toBeNull();
    expect(screen.queryByTestId("player-sheet-site-link")).toBeNull();
  });

  it("renders nothing when homepageUrl is an unsafe URL", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: "javascript:alert(1)" });
    renderSheet(station);
    expect(screen.queryByTestId("player-sheet-site-link")).toBeNull();
  });
});

describe("PlayerSheet — playable station (has streamUrl)", () => {
  it("renders the normal play button, not the site link", () => {
    const station = makeStation({ streamUrl: "https://stream.wvum.org/live" });
    renderSheet(station);
    expect(screen.getByTestId("player-sheet-toggle")).toBeTruthy();
    expect(screen.queryByTestId("player-sheet-site-link")).toBeNull();
  });
});
