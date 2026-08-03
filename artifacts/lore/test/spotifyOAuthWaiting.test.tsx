// @vitest-environment jsdom
/**
 * Tests for the Spotify OAuth waiting/error flow in ManualImportModal.
 *
 * Covers the close-time race that was latent before this fix:
 *   - When the OAuth tab closes after a SUCCESSFUL connect, no error appears.
 *     (The definitive refetchQueries awaits fresh data before deciding.)
 *   - When the OAuth tab closes WITHOUT a connection being established, an
 *     inline error message is shown.
 *
 * Both paths spy on queryClient.refetchQueries to synchronously populate the
 * cache with the desired connection state, decoupling the tests from the network.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Hoisted mock fns — must be created before vi.mock factories run.
// ---------------------------------------------------------------------------

const { mockStartSpotifyLibraryConnect } = vi.hoisted(() => ({
  mockStartSpotifyLibraryConnect: vi.fn<[], Promise<Window | null>>(),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    startSpotifyLibraryConnect: mockStartSpotifyLibraryConnect,
    // No spotify connection initially so the component takes the OAuth path.
    useMyConnections: vi.fn(() => ({ data: null, isLoading: false })),
    useLatestImportJob: vi.fn(() => ({ data: null })),
  });
});

// ---------------------------------------------------------------------------
// Subject imports (after vi.mock calls)
// ---------------------------------------------------------------------------

import { ManualImportModal } from "../src/components/ManualImportModal";
import { ME_CONNECTIONS_KEY } from "../src/lib/meHooks";
import type { MeConnection } from "../src/lib/meHooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeWindow(): { win: Window; simulateClose(): void } {
  let closed = false;
  const win = {
    get closed() { return closed; },
    close: vi.fn(() => { closed = true; }),
    location: { href: "" },
  } as unknown as Window;
  return { win, simulateClose: () => { closed = true; } };
}

/** Flush pending timers + microtasks + React re-renders. */
async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ManualImportModal — Spotify OAuth tab close-time race", () => {
  it("shows no error when the OAuth tab closes after a successful connection", async () => {
    vi.useFakeTimers();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const spotifyConn: MeConnection[] = [
      { service: "spotify", canWrite: false, connectedAt: new Date().toISOString(), lastImportAt: null },
    ];

    // When the component awaits refetchQueries on tab-close, populate cache with
    // a spotify connection so getQueryData reads a connected state.
    vi.spyOn(qc, "refetchQueries").mockImplementation(async () => {
      qc.setQueryData(ME_CONNECTIONS_KEY, spotifyConn);
    });

    const { win, simulateClose } = makeFakeWindow();
    mockStartSpotifyLibraryConnect.mockResolvedValue(win);

    render(
      <QueryClientProvider client={qc}>
        <ManualImportModal onClose={vi.fn()} initialService="spotify" />
      </QueryClientProvider>,
    );

    // Click "Connect Spotify" and flush: promise resolves → state update → effect fires.
    fireEvent.click(screen.getByRole("button", { name: /connect spotify/i }));
    await flush(0); // let handleSpotifyDirectImport await resolve + setSpotifyOAuthWaiting(true)
    await flush(0); // let the useEffect for the watcher run and install the interval

    // Waiting state must be active.
    expect(
      screen.getByRole("button", { name: /waiting for spotify/i }),
    ).toBeDefined();

    // Simulate the OAuth tab closing after the user approved.
    simulateClose();

    // Advance one poll interval — tick awaits refetchQueries (mocked to set spotify
    // connection), reads fresh cache, and must NOT produce an error.
    await flush(1500);

    expect(screen.queryByText(/spotify wasn't connected/i)).toBeNull();
    expect(screen.queryByText(/timed out/i)).toBeNull();
  });

  it("shows an inline error when the OAuth tab closes without a connection", async () => {
    vi.useFakeTimers();

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // refetchQueries populates the cache with an empty connections list.
    vi.spyOn(qc, "refetchQueries").mockImplementation(async () => {
      qc.setQueryData<MeConnection[]>(ME_CONNECTIONS_KEY, []);
    });

    const { win, simulateClose } = makeFakeWindow();
    mockStartSpotifyLibraryConnect.mockResolvedValue(win);

    render(
      <QueryClientProvider client={qc}>
        <ManualImportModal onClose={vi.fn()} initialService="spotify" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /connect spotify/i }));
    await flush(0);
    await flush(0);

    // Tab closes without a connection being established (user denied / cancelled).
    simulateClose();
    await flush(1500);

    // Inline error must appear in the Spotify guide.
    expect(screen.getByText(/spotify wasn't connected/i)).toBeDefined();
  });
});
