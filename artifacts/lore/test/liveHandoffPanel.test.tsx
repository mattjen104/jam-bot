// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Station } from "@workspace/api-client-react";
import { LiveHandoffPanel, type LiveHandoffControls } from "../src/components/LiveHandoffPanel";

const target = {
  id: 2,
  slug: "kcrw",
  name: "KCRW",
  streamUrl: "https://example.com/kcrw.mp3",
  streamFormat: "mp3",
  mode: "live",
  attribution: false,
  mayHaveAds: false,
  votes: 0,
  clickcount: 0,
  upcomingShowCount: 0,
  stationCategories: [],
} as Station;

function props(overrides: Partial<LiveHandoffControls> = {}): LiveHandoffControls {
  return {
    nextChange: {
      state: "unknown",
      remainingMs: null,
      boundaryAt: null,
      label: "Watching for the next song",
    },
    candidates: [],
    pending: null,
    noQualifiedStation: false,
    onCatchCurrent: vi.fn(),
    onCatchBest: vi.fn(),
    onCatchCandidate: vi.fn(),
    onCancel: vi.fn(),
    onSwitchNow: vi.fn(),
    onKeepWatching: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LiveHandoffPanel", () => {
  it("opens Catch Next choices and keeps scan semantics explicit", () => {
    const value = props({ scanning: true });
    render(<LiveHandoffPanel {...value} />);
    fireEvent.click(screen.getByTestId("catch-next"));
    expect(screen.getByText(/Preview scan stays separate/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("catch-current"));
    expect(value.onCatchCurrent).toHaveBeenCalledOnce();
  });

  it("shows a pending destination without interrupting cancellation", () => {
    const value = props({
      pending: {
        sourceSlug: "kexp",
        target,
        phase: "watching",
        reason: "Selected for a fresh live signal.",
        baseline: null,
        destinationNow: null,
        startedAt: 0,
        deadlineAt: 45_000,
      },
    });
    render(<LiveHandoffPanel {...value} />);
    expect(screen.getByText("Catching next on KCRW")).toBeTruthy();
    expect(screen.getByText(/Current audio continues/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("live-handoff-cancel"));
    expect(value.onCancel).toHaveBeenCalledOnce();
  });

  it("offers safe choices after the bounded wait", () => {
    const value = props({
      pending: {
        sourceSlug: "kexp",
        target,
        phase: "timed-out",
        reason: "Selected for a fresh live signal.",
        baseline: null,
        destinationNow: null,
        startedAt: 0,
        deadlineAt: 45_000,
      },
    });
    render(<LiveHandoffPanel {...value} />);
    expect(screen.getByText(/No trustworthy boundary/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("live-handoff-keep-watching"));
    expect(value.onKeepWatching).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("live-handoff-switch-now"));
    expect(value.onSwitchNow).toHaveBeenCalledOnce();
  });

  it("only offers the confirmed switch after a fresh track arrives", () => {
    const value = props({
      pending: {
        sourceSlug: "kexp",
        target,
        phase: "ready",
        reason: "Selected for 4 library matches.",
        baseline: null,
        destinationNow: {
          mbid: "new-track",
          title: "Fresh Track",
          artist: "Fresh Artist",
          artworkUrl: null,
          playedAt: "2026-09-03T12:00:00.000Z",
          freshness: "fresh",
          resolved: true,
        },
        startedAt: 0,
        deadlineAt: 45_000,
      },
    });
    render(<LiveHandoffPanel {...value} />);
    expect(screen.getByText("Fresh song ready")).toBeTruthy();
    fireEvent.click(screen.getByTestId("live-handoff-switch"));
    expect(value.onSwitchNow).toHaveBeenCalledOnce();
  });
});