// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
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

function setupFetch(
  releaseYear: Record<string, unknown>,
  runResult: Record<string, unknown>,
) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("feed-freshness")) {
      return response({ monitoringSince: new Date().toISOString(), staleCount: 0, stations: [] });
    }
    if (url.includes("resolution-latency-health")) {
      return response({
        monitoringSince: new Date().toISOString(),
        slowThresholdMs: 15_000,
        slowCount: 0,
        stations: [],
      });
    }
    if (url.includes("spinitron-web")) return response({ staleCount: 0, stations: [] });
    if (url.includes("release-year-health")) return response(releaseYear);
    if (url.includes("unmatched-spin-backfill/run")) {
      expect(init?.method).toBe("POST");
      return response(runResult);
    }
    return new Response("not found", { status: 404 });
  });
}

const baseHealth = {
  totalNull: 0,
  inQueue: 0,
  permMiss: 0,
  ineligible: 0,
  lastCheckedAt: null,
  datePending: 0,
  dateInQueue: 0,
  datePermMiss: 0,
  dateLastCheckedAt: null,
};

describe("AdminHealth — unmatched-spin run receipt", () => {
  it("shows attempted, resolved, deferred, and definitive-miss outcomes", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    setupFetch(
      {
        ...baseHealth,
        unmatchedCandidates: 4,
        unmatchedResolved: 0,
        unmatchedDeferred: 1,
        unmatchedUnavailable: 2,
      },
      {
        candidates: 4,
        scanned: 4,
        attempted: 3,
        resolved: 1,
        deferred: 1,
        unavailable: 1,
        definitiveMiss: 1,
        remaining: 1,
      },
    );

    render(<AdminHealth />);
    const button = await screen.findByRole("button", { name: "Resolve batch now" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("unmatched-run-receipt").textContent).toMatch(
        /attempted\s*3\s*·\s*resolved\s*1\s*·\s*deferred\s*1\s*·\s*definitive misses\s*1/,
      );
    });
    expect(screen.getByTestId("unmatched-deferred-count").className).toContain("text-amber");
    expect(screen.getByTestId("unmatched-definitive-miss-count").className).toContain(
      "text-destructive",
    );
  });

  it("uses legacy receipt fields when new aliases are absent", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    setupFetch(
      { ...baseHealth, unmatchedCandidates: 2 },
      {
        candidates: 2,
        scanned: 2,
        resolved: 1,
        deferred: 0,
        unavailable: 1,
        remaining: 0,
      },
    );

    render(<AdminHealth />);
    fireEvent.click(await screen.findByRole("button", { name: "Resolve batch now" }));

    await waitFor(() => {
      expect(screen.getByTestId("unmatched-run-receipt").textContent).toMatch(
        /attempted\s*2\s*·\s*resolved\s*1\s*·\s*deferred\s*0\s*·\s*definitive misses\s*1/,
      );
    });
  });
});