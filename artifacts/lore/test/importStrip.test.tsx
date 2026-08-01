// @vitest-environment jsdom
/**
 * Unit tests for ImportStrip — the site-wide in-progress banner that appears
 * while a Spotify library import is running or pending.
 *
 * Confirms:
 *  - Strip renders nothing when there is no active job.
 *  - When resumedFrom is non-null AND phase !== "fetching", the strip shows
 *    "Resuming from previous session…" and NOT "Reading your Spotify library…".
 *  - When resumedFrom is null (normal import), the strip shows
 *    "Reading your Spotify library…".
 *  - When resumedFrom is non-null but phase === "fetching" (still re-fetching
 *    Spotify from a partial buffer), the strip shows "Reading your Spotify library…"
 *    because the resume hasn't reached the resolution phase yet.
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import { ImportStrip } from "../src/components/ImportStrip";

// ---------------------------------------------------------------------------
// Mock useLatestImportJob — ImportStrip's only external dependency.
// ---------------------------------------------------------------------------

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useLatestImportJob: vi.fn(),
  });
});

import { useLatestImportJob } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JobOverride = {
  status?: "pending" | "running" | "done" | "error";
  phase?: "fetching" | "spine" | "cache" | "resolve" | null;
  total?: number;
  resolved?: number;
  resumedFrom?: number | null;
};

function mockJob(overrides: JobOverride = {}) {
  vi.mocked(useLatestImportJob).mockReturnValue({
    data: {
      jobId: 1,
      service: "spotify",
      status: "running",
      phase: "spine",
      total: 500,
      resolved: 200,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      resumedFrom: null,
      ...overrides,
    },
  } as ReturnType<typeof useLatestImportJob>);
}

// ---------------------------------------------------------------------------
// Strip visibility
// ---------------------------------------------------------------------------

describe("ImportStrip — visibility", () => {
  it("renders nothing when there is no job", () => {
    vi.mocked(useLatestImportJob).mockReturnValue({ data: null } as ReturnType<typeof useLatestImportJob>);
    const { container } = render(<ImportStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when job status is 'done'", () => {
    mockJob({ status: "done" });
    const { container } = render(<ImportStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when job status is 'error'", () => {
    mockJob({ status: "error" });
    const { container } = render(<ImportStrip />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the strip when job status is 'running'", () => {
    mockJob({ status: "running", resumedFrom: null });
    render(<ImportStrip />);
    expect(screen.getByTestId("import-strip")).toBeTruthy();
  });

  it("renders the strip when job status is 'pending'", () => {
    mockJob({ status: "pending", phase: null, resumedFrom: null });
    render(<ImportStrip />);
    expect(screen.getByTestId("import-strip")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Copy branch: resumedFrom non-null + phase !== "fetching"
// → "Resuming from previous session…"
// ---------------------------------------------------------------------------

describe("ImportStrip — 'Resuming from previous session' label", () => {
  it("shows 'Resuming from previous session' when resumedFrom is set and phase='spine'", () => {
    mockJob({ resumedFrom: 42, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.getByText(/resuming from previous session/i)).toBeTruthy();
  });

  it("does NOT show 'Reading your Spotify library' when resumedFrom is set and phase='spine'", () => {
    mockJob({ resumedFrom: 42, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.queryByText(/reading your spotify library/i)).toBeNull();
  });

  it("shows 'Resuming from previous session' when resumedFrom is set and phase='cache'", () => {
    mockJob({ resumedFrom: 7, phase: "cache" });
    render(<ImportStrip />);
    expect(screen.getByText(/resuming from previous session/i)).toBeTruthy();
  });

  it("shows 'Resuming from previous session' when resumedFrom is set and phase='resolve'", () => {
    mockJob({ resumedFrom: 7, phase: "resolve" });
    render(<ImportStrip />);
    expect(screen.getByText(/resuming from previous session/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Copy branch: resumedFrom null (normal import)
// → "Reading your Spotify library…"
// ---------------------------------------------------------------------------

describe("ImportStrip — 'Reading your Spotify library' label", () => {
  it("shows 'Reading your Spotify library' when resumedFrom is null", () => {
    mockJob({ resumedFrom: null, phase: "fetching" });
    render(<ImportStrip />);
    expect(screen.getByText(/reading your spotify library/i)).toBeTruthy();
  });

  it("does NOT show 'Resuming from previous session' when resumedFrom is null", () => {
    mockJob({ resumedFrom: null, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.queryByText(/resuming from previous session/i)).toBeNull();
  });

  it("shows 'Reading your Spotify library' even when resumedFrom is set but phase='fetching'", () => {
    // resumedFrom is only set on the complete-buffer path (which skips Spotify
    // fetch) so phase should never be "fetching" with resumedFrom set in
    // practice — but the UI guard is explicitly "phase !== fetching", so we
    // verify the boundary.
    mockJob({ resumedFrom: 99, phase: "fetching" });
    render(<ImportStrip />);
    expect(screen.getByText(/reading your spotify library/i)).toBeTruthy();
    expect(screen.queryByText(/resuming from previous session/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transition: resumed job running → done
// Confirms the "Resuming" badge and subtitle vanish once the job finishes and
// the done-state strip takes over.
// ---------------------------------------------------------------------------

describe("ImportStrip — 'Resuming' badge vanishes once import finishes", () => {
  it("shows the Resuming badge and subtitle while a resumed job is running", () => {
    mockJob({ status: "running", phase: "spine", resumedFrom: 42 });
    render(<ImportStrip />);

    expect(screen.getByTestId("import-resuming-badge")).toBeTruthy();
    expect(screen.getByText(/picked up where it left off/i)).toBeTruthy();
    expect(screen.queryByTestId("import-strip-done")).toBeNull();
  });

  it("badge and subtitle are gone once the job transitions to done; done strip renders instead", async () => {
    mockJob({ status: "running", phase: "spine", resumedFrom: 42 });
    const { rerender } = render(<ImportStrip />);

    // Sanity-check: badge is present in the running state.
    expect(screen.getByTestId("import-resuming-badge")).toBeTruthy();
    expect(screen.getByText(/picked up where it left off/i)).toBeTruthy();

    // Simulate the job completing (same jobId, same resumedFrom).
    mockJob({ status: "done", phase: null, resumedFrom: 42 });
    await act(async () => {
      rerender(<ImportStrip />);
    });

    // The done-state strip must be visible.
    expect(screen.getByTestId("import-strip-done")).toBeTruthy();
    // The "Resuming" badge and its subtitle must be gone.
    expect(screen.queryByTestId("import-resuming-badge")).toBeNull();
    expect(screen.queryByText(/picked up where it left off/i)).toBeNull();
    // The running strip must also be gone.
    expect(screen.queryByTestId("import-strip")).toBeNull();
  });
});
