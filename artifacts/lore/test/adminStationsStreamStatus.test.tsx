// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminStations from "../src/pages/AdminStations";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function station(overrides: Record<string, unknown>) {
  return {
    id: 1,
    slug: "playable-fm",
    name: "Playable FM",
    org: null,
    country: "US",
    active: true,
    source: "curated",
    nowPlayingSource: "icy",
    logoUrl: null,
    streamUrl: "https://stream.example.test/live",
    favorite: false,
    hidden: false,
    ...overrides,
  };
}

describe("AdminStations stream status", () => {
  it("marks missing streams and filters the flags list by stream availability", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/allocation")) {
        return new Response(JSON.stringify({
          budget: 40, pinnedCount: 0, leasedCount: 0, freeSlots: 40,
          pinned: [], leases: [], nextEvaluationAt: null,
        }));
      }
      if (url.includes("/flags")) {
        return new Response(JSON.stringify({
          stations: [
            station({}),
            station({
              id: 2,
              slug: "metadata-only",
              name: "Metadata Only",
              streamUrl: "",
            }),
          ],
        }));
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminStations />);

    await waitFor(() => {
      expect(screen.getByText("Playable FM")).toBeTruthy();
      expect(screen.getByTestId("playable-stream-playable-fm")).toBeTruthy();
      expect(screen.getByTestId("missing-stream-metadata-only")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("stream-filter-missing"));

    expect(screen.getByText("Metadata Only")).toBeTruthy();
    expect(screen.queryByText("Playable FM")).toBeNull();
  });
});