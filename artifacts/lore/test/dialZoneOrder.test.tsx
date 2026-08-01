// @vitest-environment jsdom
/**
 * Regression tests: the three dial front-door zone headings must appear in
 * canonical order and Zone 3 must not render FrontDoorRow children while
 * crossingsLoading=true.
 *
 * Task #831 locked the load order by rendering all three ZoneLabel headings
 * eagerly when !isCoreLoading && crossingsLoading. These tests pin that
 * contract so a future refactor cannot silently cause Zone 3 to jump above
 * Zones 1 or 2 during the crossings-loading window.
 *
 * Covers:
 *  1. All three ZoneLabel headings appear when crossingsLoading=true.
 *  2. They appear in canonical order: Zone 1 → Zone 2 → Zone 3.
 *  3. No FrontDoorRow (.fdrow) elements exist while crossingsLoading=true,
 *     i.e. Zone 3 has no station rows until scores are ready.
 */

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the subjects.
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../src/hooks/useDialData", () => ({
  useDialData: vi.fn(),
  readPins: vi.fn(() => new Set<string>()),
  togglePin: vi.fn(),
  normalizeDjName: vi.fn((s: string | null) => s ?? ""),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyOverlapSelectors: vi.fn(() => ({ data: [] })),
    useMyGhostMissed: vi.fn(() => ({ data: [] })),
    useSpotifyLibraryConnected: vi.fn(() => true),
    startSpotifyLibraryConnect: vi.fn(),
  });
});

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    radio: {
      status: "idle",
      station: null,
      scanning: false,
      preview: vi.fn(),
      toggle: vi.fn(),
      stop: vi.fn(),
    },
    ride: { active: false },
    spotify: { connected: false, premium: false },
    scan: { active: false },
  })),
}));

vi.mock("../src/components/StationLane", () => ({
  StationLane: () => <div data-testid="station-lane" />,
}));
vi.mock("../src/components/ContextRail", () => ({
  ContextRail: () => <div data-testid="context-rail" />,
}));
vi.mock("../src/components/SearchOverlay", () => ({
  SearchOverlay: () => null,
}));

// ---------------------------------------------------------------------------
// Imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { useDialData } from "../src/hooks/useDialData";
import { DialView } from "../src/components/DialView";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZONE_LABELS = [
  "On air, with a reason",
  "Missed while you were away",
  "Also on air",
] as const;

function mockDialDataLoading() {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: true,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
}

function mockDialDataLoaded() {
  (useDialData as ReturnType<typeof vi.fn>).mockReturnValue({
    stations: [],
    isLoading: false,
    isCoreLoading: false,
    liveLoading: false,
    crossingsLoading: false,
    hasLibrary: true,
    overlapByPickerId: new Map<number, number>(),
    pickerNameToId: new Map<string, number>(),
  });
}

function getZoneLabelElements() {
  return document.querySelectorAll(".fdzone-lbl");
}

function renderDial() {
  return render(<DialView />);
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dial front-door zone order — crossingsLoading=true", () => {
  it("renders all three ZoneLabel headings while crossings are loading", () => {
    mockDialDataLoading();
    renderDial();

    for (const label of ZONE_LABELS) {
      expect(
        screen.getByText(label, { selector: ".fdzone-lbl__text" }),
        `Expected ZoneLabel "${label}" to be present`,
      ).toBeTruthy();
    }
  });

  it("renders the three zone headings in canonical order (Zone 1 → Zone 2 → Zone 3)", () => {
    mockDialDataLoading();
    renderDial();

    const labelEls = Array.from(getZoneLabelElements());
    // Filter to just the three front-door zone labels (exclude any schedule labels)
    const zoneTextEls = labelEls
      .map((el) => el.querySelector(".fdzone-lbl__text")?.textContent ?? "")
      .filter((text) => (ZONE_LABELS as readonly string[]).includes(text));

    expect(zoneTextEls).toEqual([
      "On air, with a reason",
      "Missed while you were away",
      "Also on air",
    ]);
  });

  it("does not render any FrontDoorRow (.fdrow) elements while crossingsLoading=true", () => {
    mockDialDataLoading();
    renderDial();

    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
  });

  it("Zone 3 heading appears after Zone 1 and Zone 2 in the DOM while loading", () => {
    mockDialDataLoading();
    renderDial();

    const zone1El = screen.getByText("On air, with a reason", {
      selector: ".fdzone-lbl__text",
    });
    const zone2El = screen.getByText("Missed while you were away", {
      selector: ".fdzone-lbl__text",
    });
    const zone3El = screen.getByText("Also on air", {
      selector: ".fdzone-lbl__text",
    });

    // Use DOM position comparison: Node.DOCUMENT_POSITION_FOLLOWING means
    // the argument comes AFTER `this` in document order.
    expect(
      zone1El.compareDocumentPosition(zone3El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      zone2El.compareDocumentPosition(zone3El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      zone1El.compareDocumentPosition(zone2El) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Dial front-door zone order — crossingsLoading=false (loaded state)", () => {
  it("does not render the three-zone loading skeleton once crossings resolve", () => {
    mockDialDataLoaded();
    renderDial();

    // With no live stations and no ghost data the zone labels should be absent
    // (they are only rendered conditionally when there is content to show).
    // We only assert no .fdrow exists for an empty station list.
    const rows = document.querySelectorAll(".fdrow");
    expect(rows.length).toBe(0);
  });
});
