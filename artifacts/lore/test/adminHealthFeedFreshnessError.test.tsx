// @vitest-environment jsdom
/**
 * Confirms that the admin health page shows a visible error banner for the
 * feed-freshness and spinitron-web sections when their respective endpoints
 * return a non-200 response or a network error, and that the banners clear
 * when the endpoints subsequently return 200 on the next auto-refresh.
 *
 * Error kinds exercised for each section:
 *  - auth error (401)   → "Authentication error" heading
 *  - server error (500) → "Server error" heading
 *  - network rejection  → "Server error" heading
 *  - recovery: 500 on first fetch, 200 on the 30-second auto-refresh
 */
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, waitFor, cleanup, fireEvent } from "@testing-library/react";
import AdminHealth from "../src/pages/AdminHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ── Minimal ok responses ──────────────────────────────────────────────────

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

function okReleaseYearResponse() {
  return new Response(
    JSON.stringify({
      totalNull: 0,
      inQueue: 0,
      permMiss: 0,
      ineligible: 0,
      lastCheckedAt: null,
      datePending: 0,
      dateInQueue: 0,
      datePermMiss: 0,
      dateLastCheckedAt: null,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function setupToken(token = "test-token") {
  localStorage.setItem("lore_admin_token", token);
}

// ═══════════════════════════════════════════════════════════════════════════
// Feed-freshness error banner
// ═══════════════════════════════════════════════════════════════════════════

describe("AdminHealth — feed-freshness error banner", () => {
  it("shows an auth-error banner when feed-freshness-health returns 401", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) {
        return new Response(
          JSON.stringify({ error: "Invalid admin token" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ff-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ff-error-banner");
    expect(banner.textContent).toMatch(/Authentication error/i);
    expect(banner.textContent).toMatch(/Invalid admin token/i);
  });

  it("shows a server-error banner when feed-freshness-health returns 500", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) {
        return new Response(
          JSON.stringify({ error: "DB connection lost" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ff-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ff-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/DB connection lost/i);
  });

  it("shows a server-error banner when feed-freshness-health rejects at the network level (other sections stay visible)", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) {
        throw new Error("Failed to fetch");
      }
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("ff-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("ff-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/Failed to fetch/i);

    // The spinitron-web and release-year sections must not be hidden by this error.
    expect(screen.queryByText(/Error loading health data/i)).toBeNull();
  });

  it("clears the error banner and shows the healthy card when the endpoint recovers on the next refresh", async () => {
    setupToken();

    // Use a flag (not a counter) so ALL initial fetches return 500 regardless
    // of how many times the effect fires on mount; the test flips to recovery
    // mode only after confirming the banner is visible.
    let ffShouldError = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) {
        if (ffShouldError) {
          return new Response(
            JSON.stringify({ error: "DB connection lost" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            monitoringSince: new Date().toISOString(),
            staleCount: 0,
            stations: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("spinitron-web")) return okSpinitronWebResponse();
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    // Wait for the error banner — all initial fetches return 500 so the banner
    // stays visible regardless of how many times the effect fires on mount.
    await waitFor(() => {
      expect(screen.getByTestId("ff-error-banner")).toBeTruthy();
    });

    expect(screen.getByTestId("ff-error-banner").textContent).toMatch(
      /Server error/i,
    );

    // Switch to recovery mode, then trigger a refresh (same fetchAll() path as
    // the 30-second auto-refresh timer).
    ffShouldError = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    });

    // The error banner must now be gone.
    expect(screen.queryByTestId("ff-error-banner")).toBeNull();

    // With staleCount 0 and both sections healthy, the "All feeds healthy" card appears.
    expect(screen.getByText("All feeds healthy")).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Spinitron-web error banner
// ═══════════════════════════════════════════════════════════════════════════

describe("AdminHealth — spinitron-web error banner", () => {
  it("shows an auth-error banner when spinitron-web-health returns 401", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) {
        return new Response(
          JSON.stringify({ error: "Invalid admin token" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("sw-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("sw-error-banner");
    expect(banner.textContent).toMatch(/Authentication error/i);
    expect(banner.textContent).toMatch(/Invalid admin token/i);
  });

  it("shows a server-error banner when spinitron-web-health returns 500", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) {
        return new Response(
          JSON.stringify({ error: "Scraper timeout" }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("sw-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("sw-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/Scraper timeout/i);
  });

  it("shows a server-error banner when spinitron-web-health rejects at the network level (other sections stay visible)", async () => {
    setupToken();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) {
        throw new Error("Failed to fetch");
      }
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("sw-error-banner")).toBeTruthy();
    });

    const banner = screen.getByTestId("sw-error-banner");
    expect(banner.textContent).toMatch(/Server error/i);
    expect(banner.textContent).toMatch(/Failed to fetch/i);

    // The feed-freshness and release-year sections must not be hidden by this error.
    expect(screen.queryByText(/Error loading health data/i)).toBeNull();
  });

  it("clears the error banner and shows the healthy card when the endpoint recovers on the next refresh", async () => {
    setupToken();

    // Use a flag (not a counter) so ALL initial fetches return 500 regardless
    // of how many times the effect fires on mount; the test flips to recovery
    // mode only after confirming the banner is visible.
    let swShouldError = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("feed-freshness")) return okFeedFreshnessResponse();
      if (url.includes("spinitron-web")) {
        if (swShouldError) {
          return new Response(
            JSON.stringify({ error: "Scraper timeout" }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({ staleCount: 0, stations: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("release-year-health")) return okReleaseYearResponse();
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    // Wait for the error banner — all initial fetches return 500 so the banner
    // stays visible regardless of how many times the effect fires on mount.
    await waitFor(() => {
      expect(screen.getByTestId("sw-error-banner")).toBeTruthy();
    });

    expect(screen.getByTestId("sw-error-banner").textContent).toMatch(
      /Server error/i,
    );

    // Switch to recovery mode, then trigger a refresh (same fetchAll() path as
    // the 30-second auto-refresh timer).
    swShouldError = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    });

    // The error banner must now be gone.
    expect(screen.queryByTestId("sw-error-banner")).toBeNull();

    // With staleCount 0 and both sections healthy, the "All feeds healthy" card appears.
    expect(screen.getByText("All feeds healthy")).toBeTruthy();
  });
});
