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

describe("AdminHealth — schedule coverage backlog", () => {
  it("shows the remaining count and advances the cursor after a bounded batch", async () => {
    localStorage.setItem("lore_admin_token", "test-token");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("schedule-coverage-health")) {
        return response({ remaining: 23, running: false, batchLimit: 10 });
      }
      if (url.includes("schedule-coverage-backfill/run")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ afterId: 0 });
        return response({
          processed: 10,
          reasonTotals: {
            successful: 2,
            transient_fetch: 5,
            source_unavailable: 3,
            unclassified: 0,
          },
          nextAfterId: 42,
          remaining: 13,
        });
      }
      return response({}, 404);
    });

    render(<AdminHealth />);
    const section = await screen.findByTestId("schedule-coverage-health-section");
    expect(section.textContent).toContain("23");
    fireEvent.click(within(section).getByRole("button", { name: "Run 10-station batch" }));

    await waitFor(() => {
      expect(screen.getByTestId("schedule-coverage-run-receipt").textContent).toMatch(
        /processed\s*10\s*·\s*remaining\s*13\s*·\s*next cursor\s*42/,
      );
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});