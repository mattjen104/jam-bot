// @vitest-environment jsdom
/**
 * Unit tests for ImportStrip — the site-wide in-progress banner that appears
 * while a Spotify library import is running or pending, and the dismissable
 * done-state strip shown after a job finishes.
 *
 * Confirms:
 *  - Strip renders nothing when there is no active job.
 *  - When job status is 'done', a dismissable done-state strip is rendered
 *    (data-testid="import-strip-done") rather than nothing.
 *  - When resumedFrom is non-null AND phase !== "fetching", the strip shows
 *    "Picked up where it left off" and NOT "Reading your Spotify library…".
 *  - When resumedFrom is null (normal import), the strip shows
 *    "Reading your Spotify library…".
 *  - When resumedFrom is non-null but phase === "fetching" (still re-fetching
 *    Spotify from a partial buffer), the strip shows "Reading your Spotify library…"
 *    because the resume hasn't reached the resolution phase yet.
 */
import React from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { cleanup, render, screen, act, fireEvent } from "@testing-library/react";
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

const SESSION_KEY = "importStrip_dismissedJobId";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.removeItem(SESSION_KEY);
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
// → "Picked up where it left off"
// ---------------------------------------------------------------------------

describe("ImportStrip — resume label when job picks up from a stored buffer", () => {
  it("shows 'Picked up where it left off' when resumedFrom is set and phase='spine'", () => {
    mockJob({ resumedFrom: 42, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.getByText(/picked up where it left off/i)).toBeTruthy();
  });

  it("does NOT show 'Reading your Spotify library' when resumedFrom is set and phase='spine'", () => {
    mockJob({ resumedFrom: 42, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.queryByText(/reading your spotify library/i)).toBeNull();
  });

  it("shows 'Picked up where it left off' when resumedFrom is set and phase='cache'", () => {
    mockJob({ resumedFrom: 7, phase: "cache" });
    render(<ImportStrip />);
    expect(screen.getByText(/picked up where it left off/i)).toBeTruthy();
  });

  it("shows 'Picked up where it left off' when resumedFrom is set and phase='resolve'", () => {
    mockJob({ resumedFrom: 7, phase: "resolve" });
    render(<ImportStrip />);
    expect(screen.getByText(/picked up where it left off/i)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Copy branch: resumedFrom null (normal import)
// → "Reading your Spotify library…"
// ---------------------------------------------------------------------------

describe("ImportStrip — fetching-phase label (service-neutral)", () => {
  it("shows 'Importing your library…' when resumedFrom is null and phase='fetching'", () => {
    mockJob({ resumedFrom: null, phase: "fetching" });
    render(<ImportStrip />);
    expect(screen.getByText(/importing your library/i)).toBeTruthy();
  });

  it("does NOT show 'Resuming from previous session' when resumedFrom is null", () => {
    mockJob({ resumedFrom: null, phase: "spine" });
    render(<ImportStrip />);
    expect(screen.queryByText(/resuming from previous session/i)).toBeNull();
  });

  it("shows 'Importing your library…' even when resumedFrom is set but phase='fetching'", () => {
    // resumedFrom is only set on the complete-buffer path (which skips Spotify
    // fetch) so phase should never be "fetching" with resumedFrom set in
    // practice — but the UI guard is explicitly "phase !== fetching", so we
    // verify the boundary.
    mockJob({ resumedFrom: 99, phase: "fetching" });
    render(<ImportStrip />);
    expect(screen.getByText(/importing your library/i)).toBeTruthy();
    expect(screen.queryByText(/resuming from previous session/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Done-state summary text — resolved / total / unresolved counts
// ---------------------------------------------------------------------------

describe("ImportStrip — done-state summary text", () => {
  it("shows 'X of Y tracks matched' with the resolved and total counts", () => {
    mockJob({ status: "done", total: 500, resolved: 200 });
    render(<ImportStrip />);
    expect(screen.getByTestId("import-strip-done").textContent).toMatch(/200.*of.*500.*track/i);
  });

  it("shows 'Z resolving overnight' when unresolved > 0", () => {
    mockJob({ status: "done", total: 500, resolved: 200 });
    render(<ImportStrip />);
    // unresolved = 500 - 200 = 300
    expect(screen.getByTestId("import-strip-done").textContent).toMatch(/300.*resolving overnight/i);
  });

  it("does NOT show 'resolving overnight' when all tracks are resolved", () => {
    mockJob({ status: "done", total: 120, resolved: 120 });
    render(<ImportStrip />);
    expect(screen.getByTestId("import-strip-done").textContent).not.toMatch(/resolving overnight/i);
  });

  it("uses singular 'track' when total is 1", () => {
    mockJob({ status: "done", total: 1, resolved: 1 });
    render(<ImportStrip />);
    expect(screen.getByTestId("import-strip-done").textContent).toMatch(/1 track matched/i);
    expect(screen.getByTestId("import-strip-done").textContent).not.toMatch(/1 tracks matched/i);
  });
});

// ---------------------------------------------------------------------------
// Auto-dismiss: strip disappears after DONE_TTL_MS (45 s)
// ---------------------------------------------------------------------------

describe("ImportStrip — auto-dismiss after TTL", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("done strip is still visible before the TTL elapses", async () => {
    mockJob({ status: "done", total: 120, resolved: 120 });
    render(<ImportStrip />);
    await act(async () => {
      vi.advanceTimersByTime(44_999);
    });
    expect(screen.getByTestId("import-strip-done")).toBeTruthy();
  });

  it("done strip disappears once the 45 s TTL fires", async () => {
    mockJob({ status: "done", total: 120, resolved: 120 });
    const { container } = render(<ImportStrip />);
    expect(screen.getByTestId("import-strip-done")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(45_001);
    });
    expect(container.firstChild).toBeNull();
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

// ---------------------------------------------------------------------------
// sessionStorage persistence — dismissed jobId survives navigation / remount
// ---------------------------------------------------------------------------

describe("ImportStrip — sessionStorage dismissal persistence", () => {
  beforeEach(() => {
    sessionStorage.removeItem(SESSION_KEY);
  });

  it("clicking Dismiss writes the jobId to sessionStorage", async () => {
    mockJob({ jobId: 42, status: "done", total: 100, resolved: 90 });
    render(<ImportStrip />);

    const btn = screen.getByRole("button", { name: /dismiss/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(sessionStorage.getItem(SESSION_KEY)).toBe("42");
  });

  it("strip stays hidden on remount when the same done jobId is already in sessionStorage", async () => {
    // Simulate: user previously dismissed jobId 42 in this session.
    sessionStorage.setItem(SESSION_KEY, "42");

    mockJob({ jobId: 42, status: "done", total: 100, resolved: 90 });
    const { container } = render(<ImportStrip />);

    // The done strip must NOT appear.
    expect(container.firstChild).toBeNull();
  });

  it("strip re-appears after navigation back when sessionStorage holds a different jobId", async () => {
    // A different job was dismissed previously.
    sessionStorage.setItem(SESSION_KEY, "7");

    mockJob({ jobId: 42, status: "done", total: 100, resolved: 90 });
    render(<ImportStrip />);

    // jobId 42 ≠ stored 7, so the done strip must be visible.
    expect(screen.getByTestId("import-strip-done")).toBeTruthy();
  });

  it("a new distinct done job resets dismissal even if the previous one was stored", async () => {
    // First job dismissed.
    sessionStorage.setItem(SESSION_KEY, "1");

    // New job (different jobId) arrives.
    mockJob({ jobId: 2, status: "done", total: 200, resolved: 180 });
    render(<ImportStrip />);

    expect(screen.getByTestId("import-strip-done")).toBeTruthy();
  });
});
