// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({
    ride: { active: false },
    radio: { station: null },
  })),
}));

vi.mock("../src/lib/meHooks", () => ({
  useMyWeeklyRecap: vi.fn(),
}));

import { useMyWeeklyRecap } from "../src/lib/meHooks";
import WeeklyRecap from "../src/pages/WeeklyRecap";

const recap = {
  week: {
    startDate: "2026-07-26",
    endDate: "2026-08-01",
    endDateExclusive: "2026-08-02",
    timezone: "UTC" as const,
  },
  available: true as const,
  stationsAttended: {
    count: 1,
    stations: [{ slug: "kexp", name: "KEXP" }],
  },
  firstEverHeards: {
    count: 1,
    items: [{
      mbid: "track-1",
      title: "First Light",
      artist: "The Listener",
      station: { slug: "kexp", name: "KEXP" },
      heardAt: "2026-07-27T10:00:00.000Z",
    }],
  },
  ripenedCrossings: {
    count: 1,
    items: [{
      mbid: "track-2",
      title: "A Crossing Ripens",
      artist: "The Listener",
      station: { slug: "kexp", name: "KEXP" },
      ripenedAt: "2026-07-28T10:00:00.000Z",
    }],
  },
  missedGhostReplay: {
    replayId: 42,
    date: "2026-07-30",
    station: { slug: "wxyz", name: "WXYZ" },
    show: { name: "The Night Set", djName: "A DJ" },
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WeeklyRecap", () => {
  it("shows the four requested sections and links the missed replay", () => {
    vi.mocked(useMyWeeklyRecap).mockReturnValue({
      data: recap,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useMyWeeklyRecap>);

    render(<WeeklyRecap />);

    expect(screen.getByText("Stations Attended")).toBeTruthy();
    expect(screen.getByText("First-Ever-Heards")).toBeTruthy();
    expect(screen.getByText("Ripened Crossings")).toBeTruthy();
    expect(screen.getByText("Missed Ghost Replay")).toBeTruthy();
    expect(screen.getByText("2026-07-26 — 2026-08-01 · UTC")).toBeTruthy();
    expect(screen.getByRole("link", { name: /WXYZ/ }).getAttribute("href")).toBe("/replay/42");

    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/score|streak|badge|rank|percentage|progress/i);
  });

  it("keeps empty categories honest and leaves the missed replay section out", () => {
    vi.mocked(useMyWeeklyRecap).mockReturnValue({
      data: {
        ...recap,
        stationsAttended: { count: 0, stations: [] },
        firstEverHeards: { count: 0, items: [] },
        ripenedCrossings: { count: 0, items: [] },
        missedGhostReplay: null,
      },
      isLoading: false,
      error: null,
    } as ReturnType<typeof useMyWeeklyRecap>);

    render(<WeeklyRecap />);

    expect(screen.getByText("No stations attended this week.")).toBeTruthy();
    expect(screen.getByText("No first-ever-heards this week.")).toBeTruthy();
    expect(screen.getByText("No ripened crossings this week.")).toBeTruthy();
    expect(screen.queryByText("Missed Ghost Replay")).toBeNull();
  });
});