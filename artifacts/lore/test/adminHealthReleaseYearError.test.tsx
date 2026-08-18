// @vitest-environment jsdom
/**
 * Confirms that the admin health page shows a visible error banner for the
 * release-year enrichment section when the /api/admin/release-year-health
 * endpoint returns a non-200 response or a network error, and that the banner
 * clears when the endpoint subsequently returns 200 on the next auto-refresh.
 *
 * Error kinds exercised:
 *  - auth error (401) → "Authentication error" heading
 *  - server error (500) → "Server error" heading
 *  - network rejection → "Server error" heading
 *  - recovery: 500 on first fetch, 200 on the 30-second auto-refresh
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import AdminHealth from "../src/pages/AdminHealth";

const REFRESH_INTERVAL_MS = 30_000;

// Silence React act() warnings from async state updates in HealthPanel
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

/** Build a minimal ok Response for feed-freshness and spinitron-web endpoints. */
function okFeedFreshnessResponse() {
  return new Response(
    JSON.stringify({
      monitoringSince: new Date().toISOString(),
      staleCount: 0,
      stations: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function okSpinitronWebResponse() {
  return new Response(
    JSON.stringify({ staleCount: 0, stations: [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function setupToken(token = "test-token") {
  localStorage.setItem("lore_admin_token", token);
}

describe("AdminHealth — release-year error banner", () => {
  it("shows an auth-error banner when release-year-health returns 401", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) {
        return new Response(
          JSON.stringify({ error: "Invalid admin token" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ry-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ry-error-banner");
    expect(banner.textContent).toMatch(/Authentication error/i);
    expect(banner.textContent).toMatch(/Invalid admin token/i);
  });

  it("shows a server-error banner when release-year-health returns 500", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) {
        return new Response(
          JSON.stringify({ error: "DB connection lost" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ry-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ry-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/DB connection lost/i);
  });

  it("shows a server-error banner when release-year-health rejects at the network level (other sections stay visible)", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) {
        throw new Error("Failed to fetch");
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ry-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ry-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/Failed to fetch/i);

    // The feed-freshness and spinitron-web sections must not be hidden by this error.
    // When both are stale-count 0 the "All feeds healthy" card appears.
    expect(screen.queryByText(/Error loading health data/i)).toBeNull();
  });

  it("shows the release-year section normally when the endpoint returns 200", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) {
        return new Response(
          JSON.stringify({
            totalNull: 42,
            inQueue: 30,
            permMiss: 5,
            ineligible: 7,
            lastCheckedAt: null,
            datePending: 0,
            dateInQueue: 0,
            datePermMiss: 0,
            dateLastCheckedAt: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    // Error banner must not be present.
    await waitFor(() => {
      expect(screen.queryByTestId("ry-error-banner")).toBeNull();
    });

    // The real counts card should be visible instead.
    expect(screen.getByText("Release year enrichment")).toBeTruthy();
  });

  it("clears the error banner and shows the counts card when the endpoint recovers on the next auto-refresh", async () => {
    setupToken();

    // First call to release-year-health → 500 (endpoint down).
    // Subsequent calls → 200 (endpoint recovered).
    let ryCallCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) {
        ryCallCount++;
        if (ryCallCount === 1) {
          return new Response(
            JSON.stringify({ error: "DB connection lost" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        // Second call (triggered by the 30-second interval) succeeds.
        return new Response(
          JSON.stringify({
            totalNull: 10,
            inQueue: 5,
            permMiss: 2,
            ineligible: 3,
            lastCheckedAt: null,
            datePending: 0,
            dateInQueue: 0,
            datePermMiss: 0,
            dateLastCheckedAt: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("not found", { status: 404 });
    });

    vi.useFakeTimers();
    try {
      render(<AdminHealth />);

      // Flush the initial microtask that calls fetchAll() and all resulting
      // async fetch/state-update work (fetch mock resolves synchronously).
      await act(async () => {});

      // After the first fetch the error banner must be visible.
      expect(screen.getByTestId("ry-error-banner")).toBeTruthy();
      expect(screen.getByTestId("ry-error-banner").textContent).toMatch(
        /Server error/i,
      );

      // Advance the clock by 30 s to fire the auto-refresh setInterval callback.
      act(() => {
        vi.advanceTimersByTime(REFRESH_INTERVAL_MS);
      });
      // Flush the async work spawned by the second fetchAll() call.
      await act(async () => {});

      // The error banner must now be gone.
      expect(screen.queryByTestId("ry-error-banner")).toBeNull();

      // The counts card heading must be visible again.
      expect(screen.getByText("Release year enrichment")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
