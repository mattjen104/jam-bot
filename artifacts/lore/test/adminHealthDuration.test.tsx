// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AdminHealth from "../src/pages/AdminHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminHealth — duration backfill", () => {
  it("shows duration progress and the manual batch receipt", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("feed-freshness")) {
        return response({ monitoringSince: new Date().toISOString(), staleCount: 0, stations: [] });
      }
      if (url.includes("resolution-latency-health")) {
        return response({ monitoringSince: new Date().toISOString(), slowThresholdMs: 15_000, slowCount: 0, stations: [] });
      }
      if (url.includes("spinitron-web")) return response({ staleCount: 0, stations: [] });
      if (url.includes("release-year-health")) {
        return response({
          totalNull: 0,
          inQueue: 0,
          permMiss: 0,
          ineligible: 0,
          lastCheckedAt: null,
          datePending: 0,
          dateInQueue: 0,
          datePermMiss: 0,
          dateLastCheckedAt: null,
        });
      }
      if (url.includes("duration-health")) {
        return response({
          totalNull: 12,
          inQueue: 3,
          permMiss: 7,
          ineligible: 2,
          lastCheckedAt: new Date().toISOString(),
        });
      }
      if (url.includes("duration-backfill/run")) {
        expect(init?.method).toBe("POST");
        return response({ scanned: 3, updated: 2, noResult: 1, failed: 0, remaining: 0 });
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    const section = await screen.findByTestId("duration-health-section");
    expect(section.textContent).toContain("12 missing");
    expect(section.textContent).toContain("In backfill queue");
    expect(section.textContent).toContain("3");

    fireEvent.click(within(section).getByRole("button", { name: "Run batch now" }));
    await waitFor(() => {
      expect(screen.getByTestId("duration-run-receipt").textContent).toMatch(
        /scanned\s*3\s*·\s*updated\s*2\s*·\s*no result\s*1/,
      );
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/admin/duration-backfill/run"),
      ),
    ).toBe(true);
  });
});