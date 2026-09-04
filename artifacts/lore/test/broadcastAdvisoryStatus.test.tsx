// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BroadcastAdvisoryStatus } from "../src/webplayer/BroadcastAdvisoryStatus";
import type { WpNow } from "../src/webplayer/hooks";

const now = (expiresAt: string, serverTime = "2026-09-03T12:00:30.000Z"): WpNow => ({
  mbid: "recording-1",
  title: "Confirmed track",
  artist: "Confirmed artist",
  artworkUrl: null,
  playedAt: "2026-09-03T12:00:00.000Z",
  observedAt: "2026-09-03T12:00:00.000Z",
  freshness: "fresh",
  serverTime,
  resolved: true,
  broadcastAdvisory: {
    kind: "dj_speaking",
    observedAt: "2026-09-03T12:00:00.000Z",
    expiresAt,
  },
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BroadcastAdvisoryStatus", () => {
  it("announces the low-confidence state politely without private detail", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-03T12:00:30.000Z");
    render(<BroadcastAdvisoryStatus now={now("2026-09-03T12:01:30.000Z")} />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("DJ may be speaking");
    expect(status.textContent).not.toMatch(/transcript|next track|selector/i);
  });

  it("removes itself when the bounded evidence expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-03T12:00:30.000Z");
    render(<BroadcastAdvisoryStatus now={now("2026-09-03T12:00:31.000Z")} />);
    expect(screen.getByRole("status")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1_020));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("uses the server clock when the listener device clock is behind", () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-09-03T11:00:00.000Z");
    render(
      <BroadcastAdvisoryStatus
        now={now(
          "2026-09-03T12:00:31.000Z",
          "2026-09-03T12:00:30.000Z",
        )}
      />,
    );
    expect(screen.getByRole("status")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1_020));
    expect(screen.queryByRole("status")).toBeNull();
  });
});