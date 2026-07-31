// @vitest-environment jsdom
/**
 * Unit tests for SyncBar covering the sync-error / "Sync again" flow.
 *
 * Confirms:
 *  - `data-testid="library-sync-again"` button is present when
 *    syncJobData.status === "error"
 *  - Clicking "Sync again" calls the onSync handler
 *  - The button is disabled when syncBusy is true
 *  - The button is disabled when isSyncActive is true
 *  - The button is enabled when both syncBusy and isSyncActive are false
 *  - The progress bar appears while isSyncActive is true and total > 0
 *  - The error block does NOT render when syncJobData.status !== "error"
 *  - The "Reconnect Spotify" button appears only when syncNeedsReconnect is true
 *  - Clicking "Reconnect Spotify" calls onReconnect
 *  - The "Reconnect Spotify" button is disabled when reconnectBusy is true
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { SyncBar } from "../src/pages/Library";
import type { SyncJobStatus } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorJob(overrides: Partial<SyncJobStatus> = {}): SyncJobStatus {
  return {
    jobId: 1,
    service: "spotify",
    status: "error",
    phase: null,
    total: 0,
    processed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    error: "Token expired",
    results: null,
    ...overrides,
  };
}

function makeRunningJob(overrides: Partial<SyncJobStatus> = {}): SyncJobStatus {
  return {
    jobId: 2,
    service: "spotify",
    status: "running",
    phase: "matching",
    total: 200,
    processed: 80,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    results: null,
    ...overrides,
  };
}

const noop = () => {};

function renderSyncBar(props: Partial<React.ComponentProps<typeof SyncBar>> = {}) {
  const defaults: React.ComponentProps<typeof SyncBar> = {
    syncJobData: null,
    syncBusy: false,
    isSyncActive: false,
    syncError: null,
    syncNeedsReconnect: false,
    syncReceiptOpen: false,
    reconnectBusy: false,
    onSync: noop,
    onReconnect: noop,
    onToggleReceipt: noop,
  };
  return render(<SyncBar {...defaults} {...props} />);
}

// ---------------------------------------------------------------------------
// "Sync again" button presence
// ---------------------------------------------------------------------------

describe("SyncBar — 'Sync again' button", () => {
  it("renders when syncJobData.status === 'error'", () => {
    renderSyncBar({ syncJobData: makeErrorJob() });
    expect(screen.getByTestId("library-sync-again")).toBeTruthy();
  });

  it("shows the error message from syncJobData.error", () => {
    renderSyncBar({ syncJobData: makeErrorJob({ error: "Token expired" }) });
    expect(screen.getByTestId("library-sync-job-error").textContent).toContain("Token expired");
  });

  it("falls back to 'Sync failed — try again.' when error is null", () => {
    renderSyncBar({ syncJobData: makeErrorJob({ error: null }) });
    expect(screen.getByTestId("library-sync-job-error").textContent).toContain(
      "Sync failed — try again.",
    );
  });

  it("does NOT render when syncJobData is null", () => {
    renderSyncBar({ syncJobData: null });
    expect(screen.queryByTestId("library-sync-again")).toBeNull();
  });

  it("does NOT render when syncJobData.status === 'done'", () => {
    renderSyncBar({
      syncJobData: makeErrorJob({ status: "done", error: null }),
    });
    expect(screen.queryByTestId("library-sync-again")).toBeNull();
  });

  it("does NOT render when syncJobData.status === 'running'", () => {
    renderSyncBar({ syncJobData: makeRunningJob() });
    expect(screen.queryByTestId("library-sync-again")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "Sync again" click fires onSync
// ---------------------------------------------------------------------------

describe("SyncBar — 'Sync again' calls onSync", () => {
  it("triggers onSync when clicked", () => {
    const onSync = vi.fn();
    renderSyncBar({ syncJobData: makeErrorJob(), onSync });
    fireEvent.click(screen.getByTestId("library-sync-again"));
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Disabled states
// ---------------------------------------------------------------------------

describe("SyncBar — 'Sync again' disabled states", () => {
  it("is disabled when syncBusy is true", () => {
    renderSyncBar({ syncJobData: makeErrorJob(), syncBusy: true });
    expect(
      (screen.getByTestId("library-sync-again") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("is disabled when isSyncActive is true", () => {
    renderSyncBar({ syncJobData: makeErrorJob(), isSyncActive: true });
    expect(
      (screen.getByTestId("library-sync-again") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("is enabled when both syncBusy and isSyncActive are false", () => {
    renderSyncBar({
      syncJobData: makeErrorJob(),
      syncBusy: false,
      isSyncActive: false,
    });
    expect(
      (screen.getByTestId("library-sync-again") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not fire onSync when disabled via syncBusy", () => {
    const onSync = vi.fn();
    renderSyncBar({ syncJobData: makeErrorJob(), syncBusy: true, onSync });
    fireEvent.click(screen.getByTestId("library-sync-again"));
    expect(onSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// "Sync now" button disabled states and click
// ---------------------------------------------------------------------------

describe("SyncBar — 'Sync now' button", () => {
  it("is disabled when isSyncActive is true", () => {
    renderSyncBar({ isSyncActive: true });
    expect(
      (screen.getByTestId("library-sync-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("is disabled when syncBusy is true", () => {
    renderSyncBar({ syncBusy: true });
    expect(
      (screen.getByTestId("library-sync-button") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("calls onSync when clicked while enabled", () => {
    const onSync = vi.fn();
    renderSyncBar({ syncBusy: false, isSyncActive: false, onSync });
    fireEvent.click(screen.getByTestId("library-sync-button"));
    expect(onSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// "Reconnect Spotify" button — presence
// ---------------------------------------------------------------------------

describe("SyncBar — 'Reconnect Spotify' button presence", () => {
  it("renders when syncError is set and syncNeedsReconnect is true", () => {
    renderSyncBar({
      syncError: "Token expired — please reconnect.",
      syncNeedsReconnect: true,
    });
    expect(screen.getByTestId("library-reconnect-spotify")).toBeTruthy();
  });

  it("does NOT render when syncNeedsReconnect is false even if syncError is set", () => {
    renderSyncBar({
      syncError: "Something went wrong.",
      syncNeedsReconnect: false,
    });
    expect(screen.queryByTestId("library-reconnect-spotify")).toBeNull();
  });

  it("does NOT render when syncError is null even if syncNeedsReconnect is true", () => {
    renderSyncBar({
      syncError: null,
      syncNeedsReconnect: true,
    });
    expect(screen.queryByTestId("library-reconnect-spotify")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "Reconnect Spotify" button — click fires onReconnect
// ---------------------------------------------------------------------------

describe("SyncBar — 'Reconnect Spotify' calls onReconnect", () => {
  it("triggers onReconnect when clicked", () => {
    const onReconnect = vi.fn();
    renderSyncBar({
      syncError: "Token expired — please reconnect.",
      syncNeedsReconnect: true,
      onReconnect,
    });
    fireEvent.click(screen.getByTestId("library-reconnect-spotify"));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// "Reconnect Spotify" button — disabled while busy
// ---------------------------------------------------------------------------

describe("SyncBar — 'Reconnect Spotify' disabled states", () => {
  it("is disabled when reconnectBusy is true", () => {
    renderSyncBar({
      syncError: "Token expired — please reconnect.",
      syncNeedsReconnect: true,
      reconnectBusy: true,
    });
    expect(
      (screen.getByTestId("library-reconnect-spotify") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("is enabled when reconnectBusy is false", () => {
    renderSyncBar({
      syncError: "Token expired — please reconnect.",
      syncNeedsReconnect: true,
      reconnectBusy: false,
    });
    expect(
      (screen.getByTestId("library-reconnect-spotify") as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("does not fire onReconnect when disabled via reconnectBusy", () => {
    const onReconnect = vi.fn();
    renderSyncBar({
      syncError: "Token expired — please reconnect.",
      syncNeedsReconnect: true,
      reconnectBusy: true,
      onReconnect,
    });
    fireEvent.click(screen.getByTestId("library-reconnect-spotify"));
    expect(onReconnect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Progress bar appears during active sync
// ---------------------------------------------------------------------------

describe("SyncBar — progress bar during active sync", () => {
  it("renders the progress bar when isSyncActive and total > 0", () => {
    renderSyncBar({
      syncJobData: makeRunningJob({ total: 200, processed: 80 }),
      isSyncActive: true,
    });
    // The progress bar inner div has a dynamic width style
    const bar = screen.getByTestId("library-sync").querySelector(
      "[style*='background: hsl(var(--library))'][style*='width']",
    );
    expect(bar).toBeTruthy();
  });

  it("does not render the progress bar when total === 0", () => {
    renderSyncBar({
      syncJobData: makeRunningJob({ total: 0, processed: 0 }),
      isSyncActive: true,
    });
    const bar = screen.getByTestId("library-sync").querySelector(
      "[style*='background: hsl(var(--library))'][style*='width']",
    );
    expect(bar).toBeNull();
  });

  it("does not render the progress bar when isSyncActive is false", () => {
    renderSyncBar({
      syncJobData: makeRunningJob({ total: 200, processed: 80 }),
      isSyncActive: false,
    });
    const bar = screen.getByTestId("library-sync").querySelector(
      "[style*='background: hsl(var(--library))'][style*='width']",
    );
    expect(bar).toBeNull();
  });
});
