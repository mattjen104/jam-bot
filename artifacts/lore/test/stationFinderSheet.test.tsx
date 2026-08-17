// @vitest-environment jsdom
/**
 * StationFinderSheet — the Radio Browser search + pin sheet.
 *
 * Covers:
 *   - empty-query prompt and the 2-character minimum (no fetch below it)
 *   - debounced search against /api/stations/search with country/tag params
 *   - result rows: name, location, tags, stream quality
 *   - "Already in Lore" rows show a label instead of an Add button
 *   - Add → ✓ Added toggle + localStorage write; My stations Remove
 *   - Preview plays the stream URL and toggles to Stop
 *   - Escape closes the sheet
 *
 * fetch and the Audio constructor are stubbed; timers are real (the 400 ms
 * debounce is awaited via findBy and waitFor).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { StationFinderSheet } from "../src/components/StationFinderSheet";
import {
  ADDED_STATIONS_LS_KEY,
  __testOnlyResetAddedStations,
} from "../src/lib/addedStations";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const audioPlayMock = vi.fn(() => Promise.resolve());
const audioPauseMock = vi.fn();
// A regular function (not an arrow) so `new Audio(url)` works — a
// constructor that returns an object yields that object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudioCtorMock = vi.fn(function (this: any, _url?: string) {
  return {
    play: audioPlayMock,
    pause: audioPauseMock,
    addEventListener: vi.fn(),
    removeAttribute: vi.fn(),
    preload: "",
  };
});
vi.stubGlobal("Audio", AudioCtorMock);

function rbResult(overrides: Record<string, unknown> = {}) {
  return {
    name: "Boogie Radio",
    state: "California",
    country: "United States",
    tags: ["funk", "disco"],
    url: "https://cdn.example.com/boogie",
    favicon: null,
    bitrate: 128,
    codec: "MP3",
    radioBrowserUuid: "uuid-boogie",
    inLoreCatalog: false,
    ...overrides,
  };
}

function searchResponse(results: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ results }) };
}

async function typeQuery(text: string) {
  fireEvent.change(screen.getByLabelText("Search the Radio Browser directory"), {
    target: { value: text },
  });
  // Let the 400 ms debounce elapse and the fetch land.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
}

beforeEach(() => {
  localStorage.clear();
  __testOnlyResetAddedStations();
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(searchResponse([rbResult()]));
});

afterEach(() => {
  cleanup();
});

describe("StationFinderSheet", () => {
  it("shows a helpful prompt and does not fetch while the query is empty", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    expect(screen.getByText(/worldwide Radio Browser directory/)).toBeTruthy();
    // Give any (buggy) immediate fetch a chance to fire.
    await new Promise((r) => setTimeout(r, 500));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not search for queries under 2 characters", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Search the Radio Browser directory"), {
      target: { value: "a" },
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches after the debounce and renders rows with location, tags, and quality", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    await typeQuery("boogie");

    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toContain("/api/stations/search?");
    expect(url).toContain("q=boogie");

    expect(await screen.findByText("Boogie Radio")).toBeTruthy();
    expect(screen.getByText(/California · United States · 128kbps MP3/)).toBeTruthy();
    expect(screen.getByText("funk · disco")).toBeTruthy();
  });

  it("forwards the country and tag filters", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Filter by country"), { target: { value: "Canada" } });
    fireEvent.change(screen.getByLabelText("Filter by genre or tag"), { target: { value: "jazz" } });
    await typeQuery("boogie");

    const [url] = fetchMock.mock.calls[0] as [string, unknown];
    expect(url).toContain("country=Canada");
    expect(url).toContain("tag=jazz");
  });

  it("shows 'Already in Lore' instead of an Add button for catalog stations", async () => {
    fetchMock.mockResolvedValue(searchResponse([rbResult({ inLoreCatalog: true })]));
    render(<StationFinderSheet onClose={vi.fn()} />);
    await typeQuery("boogie");

    expect(await screen.findByText("Already in Lore")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add Boogie Radio/ })).toBeNull();
  });

  it("Add pins the station (✓ Added + localStorage), Remove in My stations un-pins it", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    await typeQuery("boogie");

    fireEvent.click(await screen.findByRole("button", { name: "Add Boogie Radio to my stations" }));

    // Result row flips to the Added state (scoped — the My stations section
    // shows a Remove button with the same accessible name)…
    const resultsRegion = await screen.findByRole("region", { name: "Search results" });
    expect(
      within(resultsRegion).getByRole("button", { name: "Remove Boogie Radio from my stations" }),
    ).toBeTruthy();
    // …and the pin is persisted.
    const stored = JSON.parse(localStorage.getItem(ADDED_STATIONS_LS_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].radioBrowserUuid).toBe("uuid-boogie");
    expect(stored[0].streamFormat).toBe("mp3");

    // My stations section lists the pin; its Remove un-pins.
    const myStations = screen.getByRole("region", { name: "My stations" });
    fireEvent.click(
      within(myStations).getByRole("button", { name: "Remove Boogie Radio from my stations" }),
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Add Boogie Radio to my stations" })).toBeTruthy();
    });
    expect(JSON.parse(localStorage.getItem(ADDED_STATIONS_LS_KEY) ?? "[]")).toHaveLength(0);
  });

  it("Preview plays the stream URL and toggles to Stop; clicking again pauses", async () => {
    render(<StationFinderSheet onClose={vi.fn()} />);
    await typeQuery("boogie");

    fireEvent.click(await screen.findByRole("button", { name: "Preview Boogie Radio (10 seconds)" }));

    expect(AudioCtorMock).toHaveBeenCalledWith("https://cdn.example.com/boogie");
    expect(audioPlayMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Stop preview of Boogie Radio" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop preview of Boogie Radio" }));
    expect(audioPauseMock).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Preview Boogie Radio (10 seconds)" })).toBeTruthy();
  });

  it("shows the search error when the proxy fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "Radio Browser is unreachable right now — try again in a moment." }),
    });
    render(<StationFinderSheet onClose={vi.fn()} />);
    await typeQuery("boogie");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/unreachable/);
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<StationFinderSheet onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
