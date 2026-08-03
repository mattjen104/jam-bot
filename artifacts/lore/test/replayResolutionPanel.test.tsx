// @vitest-environment jsdom
/**
 * Unit tests for ReplayResolutionPanel — the streaming-link resolution panel
 * shown on the Replay page.
 *
 * Confirms:
 *  - When coverage.resolved === coverage.total > 0 (fully resolved), the
 *    "Check availability" button is absent and the
 *    data-testid="resolution-fully-resolved" element is present.
 *  - When coverage.resolved < coverage.total, the "Check availability"
 *    button is shown and the fully-resolved notice is absent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ReplayResolutionPanel } from "../src/components/ReplayResolutionPanel";

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useReplayResolutionJob: vi.fn(() => ({ data: undefined })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ReplayResolutionPanel — fully resolved state", () => {
  it("shows the fully-resolved notice when resolved === total > 0", () => {
    render(
      <ReplayResolutionPanel
        replayId={1}
        coverage={{ total: 10, resolved: 10, unresolved: 0 }}
      />,
    );

    expect(screen.getByTestId("resolution-fully-resolved")).toBeTruthy();
    expect(screen.getByTestId("resolution-fully-resolved").textContent).toMatch(
      /10 tracks have streaming links/i,
    );
  });

  it("hides the Check-availability button when fully resolved", () => {
    render(
      <ReplayResolutionPanel
        replayId={1}
        coverage={{ total: 10, resolved: 10, unresolved: 0 }}
      />,
    );

    expect(screen.queryByTestId("resolve-tracks-button")).toBeNull();
  });
});

describe("ReplayResolutionPanel — partially resolved state", () => {
  it("shows the Check-availability button when resolved < total", () => {
    render(
      <ReplayResolutionPanel
        replayId={1}
        coverage={{ total: 10, resolved: 7, unresolved: 3 }}
      />,
    );

    expect(screen.getByTestId("resolve-tracks-button")).toBeTruthy();
  });

  it("does NOT show the fully-resolved notice when resolved < total", () => {
    render(
      <ReplayResolutionPanel
        replayId={1}
        coverage={{ total: 10, resolved: 7, unresolved: 3 }}
      />,
    );

    expect(screen.queryByTestId("resolution-fully-resolved")).toBeNull();
  });
});

describe("ReplayResolutionPanel — edge cases", () => {
  it("shows the Check-availability button when coverage is absent", () => {
    render(<ReplayResolutionPanel replayId={1} />);

    expect(screen.getByTestId("resolve-tracks-button")).toBeTruthy();
    expect(screen.queryByTestId("resolution-fully-resolved")).toBeNull();
  });

  it("shows the Check-availability button when total is 0 (no tracks yet)", () => {
    render(
      <ReplayResolutionPanel
        replayId={1}
        coverage={{ total: 0, resolved: 0, unresolved: 0 }}
      />,
    );

    expect(screen.getByTestId("resolve-tracks-button")).toBeTruthy();
    expect(screen.queryByTestId("resolution-fully-resolved")).toBeNull();
  });
});
