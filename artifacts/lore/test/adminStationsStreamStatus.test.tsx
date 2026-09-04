// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

function diagnostics(overrides: Record<string, unknown>) {
  return {
    id: 1,
    slug: "playable-fm",
    name: "Playable FM",
    org: null,
    country: "US",
    active: true,
    nowPlayingSource: "icy",
    tier: "flagship",
    source: "curated",
    qualityTier: "promising",
    metadataYield: 0.8,
    trackShaped: 0.7,
    mbidResolutionRate: 0.6,
    musicShare: 0.9,
    sampleCount: 24,
    qualityComputedAt: "2026-01-01T12:00:00.000Z",
    qualityState: "computed",
    unscoredReason: null,
    pollable: true,
    latestObservedAt: "2026-01-01T11:00:00.000Z",
    freshness: "fresh",
    streamHealth: "healthy",
    scheduleCoverage: "covered",
    category: "college",
    categoryEvidence: "explicit_tag",
    weakTailRank: 0,
    categoryReviewRank: 0,
    recomputeStatus: "ok",
    recomputeError: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminStations />
    </QueryClientProvider>,
  );
}

function mockAdminRequests(
  flags: Record<string, unknown>[],
  diagnosticRows: Record<string, unknown>[],
  queues: { weakTailStationIds: number[]; categoryReviewStationIds: number[] },
  recompute = {
    proven: 1,
    promising: 0,
    raw: 0,
    silent: 0,
    unscored: 0,
    failures: [] as { stationId: number; error: string }[],
  },
) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/recompute-quality")) {
      return json(recompute);
    }
    if (url.includes("/allocation")) {
      return json({
        budget: 40, pinnedCount: 0, leasedCount: 0, freeSlots: 40,
        pinned: [], leases: [], nextEvaluationAt: null,
      });
    }
    if (url.endsWith("/api/admin/stations")) {
      return json({
        stations: diagnosticRows,
        ...queues,
      });
    }
    if (url.includes("/flags")) {
      return json({ stations: flags });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("AdminStations stream status", () => {
  it("marks missing streams and filters the flags list by stream availability", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    mockAdminRequests(
      [
        station({}),
        station({
          id: 2,
          slug: "metadata-only",
          name: "Metadata Only",
          streamUrl: "",
        }),
      ],
      [diagnostics({}), diagnostics({ id: 2, slug: "metadata-only", name: "Metadata Only" })],
      { weakTailStationIds: [], categoryReviewStationIds: [] },
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Playable FM")).toBeTruthy();
      expect(screen.getByTestId("playable-stream-playable-fm")).toBeTruthy();
      expect(screen.getByTestId("missing-stream-metadata-only")).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("stream-filter-missing"));

    expect(screen.getByText("Metadata Only")).toBeTruthy();
    expect(screen.queryByText("Playable FM")).toBeNull();
  });

  it("shows diagnostic evidence and applies the generated review queue order", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    mockAdminRequests(
      [
        station({ id: 1, slug: "alpha", name: "Alpha" }),
        station({ id: 2, slug: "bravo", name: "Bravo" }),
        station({ id: 3, slug: "charlie", name: "Charlie" }),
      ],
      [
        diagnostics({ id: 1, slug: "alpha", name: "Alpha", weakTailRank: 2, categoryReviewRank: 1 }),
        diagnostics({ id: 2, slug: "bravo", name: "Bravo", weakTailRank: 1, categoryReviewRank: 2 }),
        diagnostics({ id: 3, slug: "charlie", name: "Charlie", weakTailRank: 3, categoryReviewRank: 3 }),
      ],
      { weakTailStationIds: [2, 1], categoryReviewStationIds: [1, 3] },
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("station-evidence-1").textContent).toContain(
        "Category: college (explicit tag)",
      );
      expect(screen.getByTestId("station-evidence-1").textContent).toContain(
        "Quality: computed · promising",
      );
      expect(screen.getByTestId("station-evidence-1").textContent).toContain(
        "Polling: pollable · samples: 24",
      );
      expect(screen.getByTestId("station-evidence-1").textContent).toContain(
        "Stream: healthy · schedule: covered",
      );
    });

    fireEvent.click(screen.getByTestId("station-view-weak-tail"));
    expect(screen.queryByTestId("station-row-3")).toBeNull();
    expect(
      screen.getByTestId("station-row-2").compareDocumentPosition(
        screen.getByTestId("station-row-1"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("station-view-category-review"));
    expect(screen.queryByTestId("station-row-2")).toBeNull();
    expect(
      screen.getByTestId("station-row-1").compareDocumentPosition(
        screen.getByTestId("station-row-3"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reports recompute results and failures, including hidden-row evidence", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    mockAdminRequests(
      [
        station({ id: 1, slug: "visible", name: "Visible" }),
        station({ id: 4, slug: "hidden", name: "Hidden", hidden: true }),
      ],
      [
        diagnostics({ id: 1, slug: "visible", name: "Visible" }),
        diagnostics({
          id: 4,
          slug: "hidden",
          name: "Hidden",
          recomputeStatus: "failed",
          recomputeError: "adapter timed out",
        }),
      ],
      { weakTailStationIds: [], categoryReviewStationIds: [] },
      {
        proven: 2,
        promising: 1,
        raw: 0,
        silent: 0,
        unscored: 0,
        failures: [{ stationId: 4, error: "adapter timed out" }],
      },
    );

    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("station-evidence-1")).toBeTruthy(),
    );
    fireEvent.click(screen.getByTestId("hidden-section-toggle"));
    expect(screen.getByTestId("station-evidence-4").textContent).toContain(
      "Recompute failed: adapter timed out",
    );

    fireEvent.click(screen.getByTestId("recompute-station-quality"));
    await waitFor(() => {
      expect(screen.getByTestId("recompute-quality-result").textContent).toContain(
        "Updated: 2 proven · 1 promising",
      );
      expect(screen.getByTestId("recompute-quality-result").textContent).toContain(
        "Station 4: adapter timed out",
      );
    });
  });
});