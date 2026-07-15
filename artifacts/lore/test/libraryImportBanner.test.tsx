// @vitest-environment jsdom
/**
 * Unit tests for LibraryImportBanner covering the fast-path scenario where all
 * tracks are already in the spine (total > 0, resolved === total, phase 3 skipped).
 *
 * Confirms:
 *  - "done" state renders "Library imported" + the matched count
 *  - "done" state does NOT render the stale "Connecting to Spotify…" label
 *  - "done" state does NOT show the in-progress spinner or progress bar
 *  - "running" state with phase="spine" renders "Checking spine…" (not "Connecting to Spotify…")
 *  - "running" state with phase="cache" also renders "Checking spine…"
 *  - "pending" state with no phase shows "Connecting to Spotify…" (correct default)
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LibraryImportBanner } from "../src/pages/Library";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noop = () => {};

describe("LibraryImportBanner — done state (fast-path re-import)", () => {
  it("shows 'Library imported' heading", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/library imported/i)).toBeTruthy();
  });

  it("shows the resolved count", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/120 tracks matched/i)).toBeTruthy();
  });

  it("does NOT show the stale 'Connecting to Spotify…' label", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("does NOT show the in-progress spinner", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    // The spinner has role="img" implicitly via Lucide SVG; check that no
    // animate-spin class is present in the rendered output.
    const el = screen.getByTestId("library-import-banner");
    expect(el.innerHTML).not.toContain("animate-spin");
  });

  it("does NOT show the progress bar track", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    const el = screen.getByTestId("library-import-banner");
    // Progress bar wrapper has a fixed h-1 class only in the pending/running branch.
    expect(el.innerHTML).not.toMatch(/class="h-1 w-full/);
  });

  it("shows dismiss button", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 120, resolved: 120, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("singular 'track' for resolved=1", () => {
    render(
      <LibraryImportBanner
        job={{ status: "done", phase: null, total: 1, resolved: 1, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/1 track matched/i)).toBeTruthy();
    expect(screen.queryByText(/1 tracks matched/i)).toBeNull();
  });
});

describe("LibraryImportBanner — running phase labels", () => {
  it("phase='spine' shows 'Checking spine…', not 'Connecting to Spotify…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "spine", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/checking spine/i)).toBeTruthy();
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("phase='cache' also shows 'Checking spine…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "cache", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/checking spine/i)).toBeTruthy();
    expect(screen.queryByText(/connecting to spotify/i)).toBeNull();
  });

  it("phase='resolve' shows 'Resolving new tracks…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "resolve", total: 80, resolved: 40, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/resolving new tracks/i)).toBeTruthy();
  });

  it("phase='fetching' shows 'Reading your Spotify library…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "running", phase: "fetching", total: 0, resolved: 0, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/reading your spotify library/i)).toBeTruthy();
  });

  it("null phase (pending) shows 'Connecting to Spotify…'", () => {
    render(
      <LibraryImportBanner
        job={{ status: "pending", phase: null, total: 0, resolved: 0, error: null }}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/connecting to spotify/i)).toBeTruthy();
  });
});
