// @vitest-environment jsdom
/**
 * Mini-player tap-to-expand contract:
 *  - tapping the bar surface (station/track text area) fires onExpand;
 *  - tapping any control button (pause, stop) does NOT fire onExpand and the
 *    control's own handler still runs;
 *  - without an onExpand prop the bar is inert to surface taps (desktop path).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { makeApiClientMock } = await import("./helpers/apiClientMock");
  return makeApiClientMock(importOriginal, {});
});

import { PlayerBar } from "../src/components/PlayerBar";
import type { Station } from "@workspace/api-client-react";

const STATION = { slug: "kexp", name: "KEXP", streamUrl: "https://kexp-mp3-128.streamguys1.com/kexp128.mp3" } as Station;

function renderBar(opts: {
  onExpand?: () => void;
  onToggle?: (s: Station) => void;
  onStop?: () => void;
} = {}) {
  return render(
    <PlayerBar
      station={STATION}
      status="playing"
      volume={0.8}
      error={null}
      onToggle={opts.onToggle ?? vi.fn()}
      onStop={opts.onStop ?? vi.fn()}
      onVolume={vi.fn()}
      onExpand={opts.onExpand}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlayerBar tap-to-expand", () => {
  it("fires onExpand when the bar surface is tapped", () => {
    const onExpand = vi.fn();
    renderBar({ onExpand });
    fireEvent.click(screen.getByTestId("player-bar-surface"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("fires onExpand when the station name text is tapped", () => {
    const onExpand = vi.fn();
    renderBar({ onExpand });
    fireEvent.click(screen.getByText("KEXP"));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire onExpand from the play/pause button — the toggle still works", () => {
    const onExpand = vi.fn();
    const onToggle = vi.fn();
    renderBar({ onExpand, onToggle });
    fireEvent.click(screen.getByTestId("player-toggle"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does NOT fire onExpand from the stop/close button — stop still works", () => {
    const onExpand = vi.fn();
    const onStop = vi.fn();
    renderBar({ onExpand, onStop });
    fireEvent.click(screen.getByTestId("player-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does NOT fire onExpand from the volume slider", () => {
    const onExpand = vi.fn();
    renderBar({ onExpand });
    fireEvent.click(screen.getByTestId("player-volume"));
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("is inert to surface taps when no onExpand is provided", () => {
    renderBar();
    // Should simply not throw.
    fireEvent.click(screen.getByTestId("player-bar-surface"));
  });
});
