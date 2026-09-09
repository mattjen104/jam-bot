// Retired UI: live-front-door ghost specs were replaced by direct coverage of the past-mode Zone2Lane.
// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Zone2Lane } from "../src/components/dial/Zone2Lane";
import type { GhostStation } from "../src/lib/meHooks";

const ghost: GhostStation = {
  stationId: 1,
  slug: "wfmu",
  name: "WFMU",
  streamUrl: "https://example.invalid/live",
  streamFormat: "mp3",
  mode: "live",
  attribution: true,
  artistName: "Broadcast Artist",
  playedAt: new Date(Date.now() - 60_000).toISOString(),
  day: "2026-01-01",
  showName: "Morning Sounds",
  djName: null,
  runId: null,
};

describe("Past-mode ghost lane", () => {
  it("renders missed-artist evidence and delegates a non-replay row activation", () => {
    const onTuneGhost = vi.fn();
    render(<Zone2Lane ghost={[ghost]} activeSlug={null} onTuneGhost={onTuneGhost} />);
    const row = document.querySelector(".ghost-row");
    expect(row?.textContent).toContain("Broadcast Artist");
    expect(row?.textContent).not.toContain("played");
    fireEvent.click(row!);
    expect(onTuneGhost).toHaveBeenCalledWith(ghost);
    expect(screen.queryByRole("button", { name: /^See all/ })).toBeNull();
  });
});