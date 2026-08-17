// @vitest-environment jsdom
/**
 * PlayerBar / PlayerSheet attribution-only station fallback contract:
 *   - stations with no streamUrl and no relayUrl show a fixed-size icon-only
 *     site link instead of the play/pause button;
 *   - the link opens the station's homepageUrl in a new tab;
 *   - clicking the link does NOT invoke tune-in or stop playback;
 *   - stations with a valid streamUrl keep the normal play button;
 *   - invalid / missing homepage URLs suppress the fallback control entirely.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {});
});

import { PlayerBar } from "../src/components/PlayerBar";
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

function renderBar(station: Station) {
  return render(
    <PlayerBar
      station={station}
      status="idle"
      volume={0.8}
      error={null}
      onToggle={vi.fn()}
      onStop={vi.fn()}
      onVolume={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlayerBar — attribution-only station (no stream)", () => {
  it("renders the fixed-size site link instead of the play button", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null });
    renderBar(station);
    expect(screen.queryByTestId("player-toggle")).toBeNull();
    const link = screen.getByTestId("player-site-link") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    // Must carry the shared fixed-size control classes
    expect(link.className).toContain("player-bar-btn");
    expect(link.className).toContain("station-site-link");
  });

  it("site link points to the station homepageUrl", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: "https://wvum.org" });
    renderBar(station);
    const link = screen.getByTestId("player-site-link") as HTMLAnchorElement;
    expect(link.href).toBe("https://wvum.org/");
  });

  it("site link opens in a new tab with noopener", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null });
    renderBar(station);
    const link = screen.getByTestId("player-site-link") as HTMLAnchorElement;
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("site link has accessible label identifying the station", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, name: "WVUM" });
    renderBar(station);
    const link = screen.getByTestId("player-site-link") as HTMLAnchorElement;
    expect(link.getAttribute("aria-label")).toBe("Open WVUM site");
    expect(link.title).toBe("Open WVUM site");
  });

  it("clicking the site link does not invoke onToggle or onStop", () => {
    const onToggle = vi.fn();
    const onStop = vi.fn();
    const station = makeStation({ streamUrl: "", relayUrl: null });
    render(
      <PlayerBar
        station={station}
        status="idle"
        volume={0.8}
        error={null}
        onToggle={onToggle}
        onStop={onStop}
        onVolume={vi.fn()}
      />,
    );
    const link = screen.getByTestId("player-site-link");
    fireEvent.click(link);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onStop).not.toHaveBeenCalled();
  });

  it("renders nothing in the play-button slot when homepageUrl is absent", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: null });
    renderBar(station);
    expect(screen.queryByTestId("player-toggle")).toBeNull();
    expect(screen.queryByTestId("player-site-link")).toBeNull();
  });

  it("renders nothing when homepageUrl is an invalid URL", () => {
    const station = makeStation({ streamUrl: "", relayUrl: null, homepageUrl: "javascript:alert(1)" });
    renderBar(station);
    expect(screen.queryByTestId("player-site-link")).toBeNull();
  });
});

describe("PlayerBar — playable station (has streamUrl)", () => {
  it("renders the normal play button, not the site link", () => {
    const station = makeStation({ streamUrl: "https://stream.wvum.org/live" });
    renderBar(station);
    expect(screen.getByTestId("player-toggle")).toBeTruthy();
    expect(screen.queryByTestId("player-site-link")).toBeNull();
  });

  it("renders the normal play button when only a relayUrl exists", () => {
    const station = makeStation({ streamUrl: "", relayUrl: "/api/stations/wvum/relay" });
    renderBar(station);
    expect(screen.getByTestId("player-toggle")).toBeTruthy();
    expect(screen.queryByTestId("player-site-link")).toBeNull();
  });
});
