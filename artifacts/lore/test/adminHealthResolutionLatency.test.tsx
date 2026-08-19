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

function response(body: object) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function setupHealthFetch(latency: object) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("feed-freshness")) {
      return response({ monitoringSince: new Date().toISOString(), staleCount: 0, stations: [] });
    }
    if (url.includes("resolution-latency-health")) return response(latency);
    if (url.includes("spinitron-web")) return response({ staleCount: 0, stations: [] });
    if (url.includes("release-year-health")) {
      return response({
        totalNull: 0, inQueue: 0, permMiss: 0, ineligible: 0, lastCheckedAt: null,
        datePending: 0, dateInQueue: 0, datePermMiss: 0, dateLastCheckedAt: null,
      });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("AdminHealth — resolution latency", () => {
  it("lists each slow station with its rolling latency summary", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    setupHealthFetch({
      monitoringSince: new Date().toISOString(),
      slowThresholdMs: 15_000,
      slowCount: 1,
      stations: [{
        stationId: 17, slug: "slow-fm", sampleCount: 42,
        medianMs: 16_500, p95Ms: 28_400, maxMs: 35_000,
      }],
    });

    render(<AdminHealth />);

    const section = await screen.findByTestId("resolution-latency-section");
    expect(section.textContent).toContain("Slow track resolution");
    expect(section.textContent).toContain("slow-fm");
    expect(section.textContent).toContain("42");
    expect(section.textContent).toContain("16s");
    expect(section.textContent).toContain("28s");
    expect(section.textContent).toContain("35s");
  });

  it("confirms when no station exceeds the slow threshold", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    setupHealthFetch({
      monitoringSince: new Date().toISOString(),
      slowThresholdMs: 15_000,
      slowCount: 0,
      stations: [],
    });

    render(<AdminHealth />);

    await waitFor(() => {
      expect(screen.getByText("All stations resolving quickly")).toBeTruthy();
    });
  });
});