// @vitest-environment jsdom
/**
 * Unit tests for LibraryRow "Door 3 — Broadcast" navigation path.
 *
 * Covers three cases from the broadcastHref branch in DoorStrip:
 *   1. Clicking "📻 Broadcast" navigates to /archive/selectors/<handle>
 *      when provenance has a pickerHandle.
 *   2. Clicking "📻 Broadcast" navigates to /archive/stations/<slug>
 *      when provenance has a stationSlug but no pickerHandle.
 *   3. The Broadcast button is disabled when neither pickerHandle nor
 *      stationSlug is present.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Hoist mock fns — must be created before vi.mock() factories execute.
// ---------------------------------------------------------------------------

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/", mockNavigate],
}));

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal);
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {
    spotifyPlay: vi.fn(async () => undefined),
    getRecordingAlbumTracks: vi.fn(async () => ({ tracks: [], rgTitle: null })),
  });
});

// ---------------------------------------------------------------------------
// Imports (must follow vi.mock calls)
// ---------------------------------------------------------------------------

import { usePlayer } from "../src/player/PlayerProvider";
import { LibraryRow } from "../src/components/LibraryRow";
import type { LibraryItem } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const MBID = "broadcast-test-mbid-9012";
const PICKER_HANDLE = "dj-sunshine";
const STATION_SLUG = "kexp-seattle";

function makeItem(provOverrides: LibraryItem["provenance"]): LibraryItem {
  return {
    mbid: MBID,
    addedAt: "2024-01-01T00:00:00Z",
    provenance: provOverrides,
    recording: {
      title: "Some Track",
      artist: "Some Artist",
      artworkUrl: null,
      albumTitle: null,
      spotifyUrl: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlayer() {
  return {
    ride: { active: false, startReplay: vi.fn() },
    spotify: {
      configured: true,
      connected: false,
      premium: false,
      displayName: null,
      product: "free",
      notice: null,
      clearNotice: vi.fn(),
      showNotice: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      refresh: vi.fn(),
      pinnedDevice: null,
      fetchDevices: vi.fn(async () => []),
      pinDevice: vi.fn(),
      unpinDevice: vi.fn(),
    },
    scan: {} as never,
    radio: {} as never,
  };
}

function renderRow(item: LibraryItem) {
  vi.mocked(usePlayer).mockReturnValue(makePlayer());

  return render(
    <ul>
      <LibraryRow item={item} isOpen={true} onToggle={vi.fn()} />
    </ul>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Door 3 — pickerHandle present → navigates to selector page", () => {
  it("calls navigate with /archive/selectors/<handle> when provenance has a pickerHandle", () => {
    const item = makeItem({
      kind: "keep",
      pickerHandle: PICKER_HANDLE,
      pickerName: "DJ Sunshine",
      stationSlug: STATION_SLUG,
      stationName: "KEXP Seattle",
    });

    renderRow(item);

    fireEvent.click(screen.getByTitle("Go to broadcast context"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(`/archive/selectors/${PICKER_HANDLE}`);
  });

  it("uses pickerHandle over stationSlug when both are present", () => {
    const item = makeItem({
      kind: "keep",
      pickerHandle: PICKER_HANDLE,
      stationSlug: STATION_SLUG,
    });

    renderRow(item);

    fireEvent.click(screen.getByTitle("Go to broadcast context"));

    expect(mockNavigate).toHaveBeenCalledWith(`/archive/selectors/${PICKER_HANDLE}`);
  });
});

describe("Door 3 — stationSlug only → navigates to station page", () => {
  it("calls navigate with /archive/stations/<slug> when provenance has stationSlug but no pickerHandle", () => {
    const item = makeItem({
      kind: "keep",
      stationSlug: STATION_SLUG,
      stationName: "KEXP Seattle",
    });

    renderRow(item);

    fireEvent.click(screen.getByTitle("Go to broadcast context"));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(`/archive/stations/${STATION_SLUG}`);
  });
});

describe("Door 3 — neither pickerHandle nor stationSlug → button is disabled", () => {
  it("renders a disabled Broadcast button when provenance kind is keep with no handle or slug", () => {
    const item = makeItem({ kind: "keep" });

    renderRow(item);

    const btn = screen.getByTitle("No broadcast history");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });

  it("does not call navigate when the disabled button is present", () => {
    const item = makeItem({ kind: "keep" });

    renderRow(item);

    // The enabled button with "Go to broadcast context" title should not exist
    expect(screen.queryByTitle("Go to broadcast context")).toBeNull();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("renders a disabled Broadcast button when provenance kind is import", () => {
    const item = makeItem({ kind: "import", service: "spotify" });

    renderRow(item);

    const btn = screen.getByTitle("No broadcast history");
    expect(btn.hasAttribute("disabled")).toBe(true);
  });
});
