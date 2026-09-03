// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Station } from "@workspace/api-client-react";
import { PlayerBar } from "../src/components/PlayerBar";

const station = {
  slug: "test-radio",
  name: "Test Radio",
  streamUrl: "https://radio.test/live.mp3",
  streamFormat: "mp3",
  homepageUrl: "https://radio.test",
} as Station;

afterEach(cleanup);

describe("PlayerBar recovery states", () => {
  it("distinguishes alternate recovery from ordinary buffering", () => {
    render(
      <PlayerBar
        station={station}
        status="recovering"
        volume={0.8}
        error={null}
        onToggle={vi.fn()}
        onStop={vi.fn()}
        onVolume={vi.fn()}
      />,
    );
    expect(screen.getByTestId("player-recovery-status").textContent)
      .toContain("Trying alternate stream");
  });

  it("offers both a manual retry and station-site fallback after exhaustion", () => {
    const retry = vi.fn();
    render(
      <PlayerBar
        station={station}
        status="error"
        volume={0.8}
        error="This stream is unavailable."
        onRetry={retry}
        onToggle={vi.fn()}
        onStop={vi.fn()}
        onVolume={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("player-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByTestId("player-error-site-link") as HTMLAnchorElement).href,
    ).toBe("https://radio.test/");
  });
});