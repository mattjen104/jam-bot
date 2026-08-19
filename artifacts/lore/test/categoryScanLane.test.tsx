// @vitest-environment jsdom
/**
 * CategoryScanLane / CategoryScanButton — the Scan lens: one now-playing
 * button per station category.
 *
 * Covers:
 *  1. Renders one button per category present in the station list, in the
 *     editorial STATION_CATEGORY_DEFINITIONS order.
 *  2. Each button shows the category label and a rotating
 *     `artist · station name` line from the now-playing map.
 *  3. Stations with unknown/blank artists are skipped by the rotation and
 *     excluded from the "N live" badge.
 *  4. The rotation advances to the next live station after SCAN_ROTATE_MS.
 *  5. Clicking a button tunes to the station whose track is shown.
 *  6. The tuned station's button carries the active accent class.
 *  7. Categories with zero curated stations are omitted; stations with no
 *     server-supplied category (personal stations) never appear.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CategoryScanLane } from "../src/components/dial/CategoryScanLane";
import { SCAN_ROTATE_MS } from "../src/components/dial/CategoryScanButton";
import type { Station } from "@workspace/api-client-react";
import type { DialSpin } from "../src/hooks/useDialData";

function station(slug: string, name: string, categories?: string[]): Station {
  return { slug, name, stationCategories: categories ?? [] } as unknown as Station;
}

function spin(artist: string, title = "Track"): DialSpin {
  return {
    mbid: null,
    artistMbid: null,
    title,
    artist,
    playedAt: new Date().toISOString(),
    isLibraryHit: false,
    isArtistHit: false,
    isFirstSpin: false,
    releaseYear: null,
    ageTier: null,
  };
}

const STATIONS: Station[] = [
  station("kexp", "KEXP", ["anchor"]),
  station("nts", "NTS", ["anchor"]),
  station("wvum", "WVUM", ["campus"]),
  station("fip-jazz", "FIP Jazz", ["specialist"]),
  station("sleepy", "Sleep Radio", ["ambient"]),
  // A personal (Radio Browser) station — no server categories, must not appear.
  station("personal-1", "My Web Station"),
];

const NOW_PLAYING = new Map<string, DialSpin>([
  ["kexp", spin("The Smile")],
  ["nts", spin("Unknown Artist")],
  ["wvum", spin("Floating Points")],
  ["fip-jazz", spin("Nubya Garcia")],
  ["sleepy", spin("")],
]);

function renderLane(overrides: Partial<React.ComponentProps<typeof CategoryScanLane>> = {}) {
  const props = {
    stations: STATIONS,
    nowPlayingBySlug: NOW_PLAYING,
    activeSlug: null,
    onTuneIn: vi.fn(),
    ...overrides,
  };
  const utils = render(<CategoryScanLane {...props} />);
  return { ...utils, props };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("CategoryScanLane", () => {
  it("renders one button per represented category in editorial order", () => {
    renderLane();
    const lane = screen.getByTestId("dial-scan-lane");
    const labels = [...lane.querySelectorAll(".dial-scan__label")].map((el) => el.textContent);
    expect(labels).toEqual([
      "Ambient & Sleep",
      "Campus Radio",
      "Specialist Radio",
      "Anchor Stations",
    ]);
    // The personal station (no server category) renders nothing.
    expect(screen.queryByText(/My Web Station/)).toBeNull();
    // Categories with no curated stations (Public & Community, Independent
    // DJ, Discovery) are omitted entirely.
    expect(screen.queryByText("Public & Community")).toBeNull();
  });

  it("shows the rotating artist · station line from the now-playing map", () => {
    renderLane();
    expect(screen.getByTestId("dial-scan-anchor").textContent).toContain("The Smile · KEXP");
    expect(screen.getByTestId("dial-scan-campus").textContent).toContain("Floating Points · WVUM");
    expect(screen.getByTestId("dial-scan-specialist").textContent).toContain("Nubya Garcia · FIP Jazz");
  });

  it("skips unknown/blank artists in the live count and shows quiet copy", () => {
    renderLane();
    // NTS plays "Unknown Artist" → only KEXP counts for Anchor Stations.
    expect(screen.getByTestId("dial-scan-anchor").textContent).toContain("1 live");
    expect(screen.getByTestId("dial-scan-anchor").textContent).toContain("The Smile");
    // Sleep Radio's artist is blank → no live stations, honest quiet copy.
    const ambient = screen.getByTestId("dial-scan-ambient") as HTMLButtonElement;
    expect(ambient.textContent).toContain("0 live");
    expect(ambient.textContent).toContain("Quiet right now");
    expect(ambient.disabled).toBe(true);
  });

  it("clicking a button tunes to the station whose track is shown", () => {
    const { props } = renderLane();
    fireEvent.click(screen.getByTestId("dial-scan-campus"));
    expect(props.onTuneIn).toHaveBeenCalledWith("wvum");
    fireEvent.click(screen.getByTestId("dial-scan-anchor"));
    expect(props.onTuneIn).toHaveBeenCalledWith("kexp");
  });

  it("rotates to the next live station in the category after the interval", () => {
    vi.useFakeTimers();
    const bothLive = new Map<string, DialSpin>([
      ["kexp", spin("The Smile")],
      ["nts", spin("Andrew Weatherall")],
    ]);
    renderLane({ nowPlayingBySlug: bothLive });
    const anchor = screen.getByTestId("dial-scan-anchor");
    expect(anchor.textContent).toContain("2 live");
    expect(anchor.textContent).toContain("The Smile");
    act(() => {
      vi.advanceTimersByTime(SCAN_ROTATE_MS);
    });
    expect(anchor.textContent).toContain("Andrew Weatherall");
    expect(anchor.textContent).toContain("NTS");
    // Wraps back to the first station.
    act(() => {
      vi.advanceTimersByTime(SCAN_ROTATE_MS);
    });
    expect(anchor.textContent).toContain("The Smile");
  });

  it("accents the button showing the station the listener is tuned to", () => {
    renderLane({ activeSlug: "wvum" });
    expect(screen.getByTestId("dial-scan-campus").className).toContain("dial-scan__btn--active");
    expect(screen.getByTestId("dial-scan-anchor").className).not.toContain("dial-scan__btn--active");
  });
});
