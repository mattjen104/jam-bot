// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdminHealth from "../src/pages/AdminHealth";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("AdminHealth poller process diagnostics", () => {
  it("labels a fleet-wide stale heartbeat as a process outage", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/poller-health")) {
        return new Response(
          JSON.stringify({
            active: true,
            stale: true,
            status: "stalled",
            heartbeatAt: "2026-09-07T10:00:00.000Z",
            staleThresholdMs: 180000,
            expectedStationCount: 14,
            enrolledStationCount: 14,
            rosterComplete: true,
            lastCycleCompletedAt: "2026-09-07T09:58:00.000Z",
            attemptedStationCount: 14,
            successfulStationCount: 12,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/feed-freshness-health")) {
        return new Response(
          JSON.stringify({
            monitoringSince: "2026-09-07T09:00:00.000Z",
            staleCount: 0,
            stations: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/spinitron-web-health")) {
        return new Response(JSON.stringify({ staleCount: 0, stations: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    render(<AdminHealth />);

    await waitFor(() => expect(screen.getByTestId("poller-health-section")).toBeTruthy());
    const section = screen.getByTestId("poller-health-section");
    expect(section.textContent).toMatch(/poller\/process outage/i);
    expect(section.textContent).toMatch(/14 \/ 14/);
    expect(section.textContent).toMatch(/Successful observations12/);
  });
});