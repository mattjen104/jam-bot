// @vitest-environment jsdom
import React, { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSongBottles } from "../src/hooks/useSongBottles";
import { useStationPresence } from "../src/hooks/useStationPresence";

const fetchMock = vi.fn();
const eventSources: string[] = [];

vi.stubGlobal("fetch", fetchMock);
vi.stubGlobal("EventSource", class {
  addEventListener = vi.fn();
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(url: string) {
    eventSources.push(url);
  }
});

function BottlesHarness() {
  useSongBottles("recording-id", 42);
  return null;
}

function PresenceHarness() {
  useStationPresence([42, 7]);
  return null;
}

function renderWithQuery(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  eventSources.length = 0;
});

describe("social API paths", () => {
  it("keeps bottle fetches and SSE at the root API when Lore is mounted below root", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ bottles: [], archivedCount: 0 }),
    });

    render(<BottlesHarness />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/songs/recording-id/bottles",
        { credentials: "include" },
      );
    });
    expect(eventSources).toEqual(["/api/stations/42/bottles/stream"]);
    expect(eventSources[0]).not.toContain("/lore/");
  });

  it("keeps station presence polling at the root API", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ presence: {} }),
    });

    renderWithQuery(<PresenceHarness />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/stations/social/presence?ids=42,7",
        { credentials: "include" },
      );
    });
  });
});