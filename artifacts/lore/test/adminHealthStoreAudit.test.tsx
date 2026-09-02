// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

describe("AdminHealth — station store audit", () => {
  it("shows detected purchase evidence and starts a bounded scan", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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
      if (url.endsWith("/api/admin/stations/store-audit")) {
        return response({
          generatedAt: new Date().toISOString(),
          summary: {
            total: 2,
            found: 1,
            notFound: 0,
            pending: 1,
            unavailable: 0,
            blocked: 0,
          },
          stations: [
            {
              stationId: 1,
              slug: "shop-fm",
              name: "Shop FM",
              homepageUrl: "https://radio.example",
              storeUrl: "https://radio.example/merch",
              storeLabel: "Station merch",
              storeSignal: "path",
              storeStatus: "found",
              storeCheckedAt: new Date().toISOString(),
              homepageScrapedAt: new Date().toISOString(),
            },
            {
              stationId: 2,
              slug: "pending-fm",
              name: "Pending FM",
              homepageUrl: "https://pending.example",
              storeUrl: null,
              storeLabel: null,
              storeSignal: null,
              storeStatus: "pending",
              storeCheckedAt: null,
              homepageScrapedAt: null,
            },
          ],
        });
      }
      if (url.endsWith("/api/admin/stations/store-audit/run")) {
        return response({ accepted: true, batchSize: 25 }, 202);
      }
      return response({ error: "not found" }, 404);
    });

    render(<AdminHealth />);

    const section = await screen.findByTestId("station-store-audit-section");
    expect(section.textContent).toContain("Shop FM");
    expect(section.textContent).toContain("Station merch");
    expect(section.textContent).toContain("1 found");

    fireEvent.click(screen.getByTestId("station-store-audit-run"));
    expect(await screen.findByText(/Batch accepted/)).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/api/admin/stations/store-audit/run"),
      ),
    ).toBe(true);
  });
});