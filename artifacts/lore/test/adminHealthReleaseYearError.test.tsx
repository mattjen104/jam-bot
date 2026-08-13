// @vitest-environment jsdom
/**
 * Confirms that the admin health page shows a visible error banner for the
 * release-year enrichment section when the /api/admin/release-year-health
 * endpoint returns a non-200 response or a network error.
 *
 * Two error kinds are exercised:
 *  - auth error (401) → "Authentication error" heading
 *  - server error (500) → "Server error" heading
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import AdminHealth from "../src/pages/AdminHealth";

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
});
