// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import AdminHealth from "../src/pages/AdminHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function response(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminHealth — Spinitron capabilities", () => {
  it("labels missing credentials as optional history and handles partial counts", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("spinitron-capability-health")) {
        return response({
          stations: [
            {
              stationId: 1,
              stationSlug: "wprb",
              stationName: "WPRB",
              source: "spinitron_web",
              capabilities: {
                publicLiveMetadata: true,
                publicSchedule: true,
                authenticatedHistory: false,
                historyStatus: "not_configured",
                directoryCoverage: "public_fallback",
              },
            },
            {
              stationId: 2,
              stationSlug: "api-station",
              capabilities: {
                authenticatedHistory: true,
                historyStatus: "available",
              },
            },
          ],
          totals: {},
        });
      }
      return new Response(JSON.stringify({ error: "not part of this test" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByTestId("spinitron-capabilities-section")).toBeTruthy();
    });
    const section = screen.getByTestId("spinitron-capabilities-section");
    expect(section.textContent).toContain("1 optional history not configured");
    expect(section.textContent).toContain("Optional history not configured");
    expect(section.textContent).toContain("api-station");
    expect(section.textContent).not.toMatch(/outage|empty archive/i);
  });
});