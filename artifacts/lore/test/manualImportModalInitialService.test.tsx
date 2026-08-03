// @vitest-environment jsdom
/**
 * Unit tests for ManualImportModal — initialService prop routing.
 *
 * Confirms:
 *   - With no initialService, the modal opens at the service-picker screen.
 *   - With initialService="spotify", the modal opens directly at the
 *     service-guide screen (Spotify), bypassing the service-picker.
 *   - The service-picker grid is NOT rendered when initialService="spotify".
 *   - The back button IS rendered when initialService="spotify" (non-picker mode).
 *   - Other initialService values also bypass the picker correctly:
 *     "listenbrainz" → listenbrainz input, "lastfm" → lfm-hint input.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mock fns
// ---------------------------------------------------------------------------

const { mockUseMyConnections, mockUseLatestImportJob } = vi.hoisted(() => ({
  mockUseMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
  mockUseLatestImportJob: vi.fn(() => ({ data: null })),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyConnections: mockUseMyConnections,
    useLatestImportJob: mockUseLatestImportJob,
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

async function renderModal(
  props: { onClose?: () => void; initialService?: import("../src/components/ManualImportModal").ServiceId } = {},
) {
  const { ManualImportModal } = await import("../src/components/ManualImportModal");
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <ManualImportModal onClose={props.onClose ?? vi.fn()} initialService={props.initialService} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMyConnections.mockReturnValue({ data: null, isLoading: false });
  mockUseLatestImportJob.mockReturnValue({ data: null });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Default (no initialService) — opens at service-picker
// ---------------------------------------------------------------------------

describe("ManualImportModal — default (no initialService)", () => {
  it("renders the service-picker grid", async () => {
    await renderModal();
    expect(screen.getByTestId("service-picker")).toBeTruthy();
  });

  it("shows the 'Where is your music?' header", async () => {
    await renderModal();
    expect(screen.getByText("Where is your music?")).toBeTruthy();
  });

  it("does NOT show the back button on the picker screen", async () => {
    await renderModal();
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("renders a tile for each major service", async () => {
    await renderModal();
    expect(screen.getByTestId("service-tile-spotify")).toBeTruthy();
    expect(screen.getByTestId("service-tile-applemusic")).toBeTruthy();
    expect(screen.getByTestId("service-tile-lastfm")).toBeTruthy();
    expect(screen.getByTestId("service-tile-listenbrainz")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// initialService="spotify" — opens directly at Spotify service-guide
// ---------------------------------------------------------------------------

describe("ManualImportModal — initialService='spotify'", () => {
  it("does NOT render the service-picker grid", async () => {
    await renderModal({ initialService: "spotify" });
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("shows the 'Spotify' header title", async () => {
    await renderModal({ initialService: "spotify" });
    expect(screen.getByText("Spotify")).toBeTruthy();
  });

  it("shows the 'Connect Spotify' section heading", async () => {
    await renderModal({ initialService: "spotify" });
    // "Connect Spotify" appears as both the section heading <p> and the button;
    // use getAllByText to handle the multiple matches.
    expect(screen.getAllByText("Connect Spotify").length).toBeGreaterThan(0);
  });

  it("renders the back button (non-picker mode)", async () => {
    await renderModal({ initialService: "spotify" });
    expect(screen.getByLabelText("Back")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// initialService="listenbrainz" — opens at listenbrainz input
// ---------------------------------------------------------------------------

describe("ManualImportModal — initialService='listenbrainz'", () => {
  it("does NOT render the service-picker grid", async () => {
    await renderModal({ initialService: "listenbrainz" });
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("shows the ListenBrainz username input", async () => {
    await renderModal({ initialService: "listenbrainz" });
    expect(screen.getByTestId("listenbrainz-username-input")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// initialService="lastfm" — opens at lfm-hint screen
// ---------------------------------------------------------------------------

describe("ManualImportModal — initialService='lastfm'", () => {
  it("does NOT render the service-picker grid", async () => {
    await renderModal({ initialService: "lastfm" });
    expect(screen.queryByTestId("service-picker")).toBeNull();
  });

  it("shows the Last.fm username input", async () => {
    await renderModal({ initialService: "lastfm" });
    expect(screen.getByTestId("lastfm-username-input")).toBeTruthy();
  });
});
