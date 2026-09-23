// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const startImport = vi.fn();
const latestJob = vi.fn();
const importStats = vi.fn();
vi.mock("../src/lib/meHooks", () => ({
  ME_LATEST_IMPORT_JOB_KEY: ["me", "import-job", "latest"],
  postStartImport: (...args: unknown[]) => startImport(...args),
  useLatestImportJob: () => latestJob(),
  useMyImportStats: () => importStats(),
}));

import { RadioImportStatus } from "../src/components/RadioImportStatus";

function renderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><RadioImportStatus /></QueryClientProvider>);
}

describe("Radio import status", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the current listener's fetched and live imported counts separately", () => {
    latestJob.mockReturnValue({
      data: { jobId: 3, service: "spotify", status: "done", total: 1800 },
      isPending: false,
      isError: false,
    });
    importStats.mockReturnValue({ data: { total: 1792, softCount: 24 } });
    renderStatus();

    expect(screen.getByText(/1,800 tracks fetched in the last completed import/)).toBeTruthy();
    expect(screen.getByText(/1,792 distinct active imported tracks/)).toBeTruthy();
    expect(screen.getByText(/24 still need an exact match/)).toBeTruthy();
  });

  it("rechecks all connected Spotify tracks only when requested", async () => {
    latestJob.mockReturnValue({ data: null, isPending: false, isError: false });
    importStats.mockReturnValue({ data: null });
    startImport.mockResolvedValue({ jobId: 4, status: "pending" });
    renderStatus();
    expect(startImport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Recheck Spotify" }));
    await waitFor(() => expect(startImport).toHaveBeenCalledWith("spotify"));
  });

  it("retries a failed status read instead of starting a second import", () => {
    const refetch = vi.fn();
    latestJob.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    importStats.mockReturnValue({ data: null });
    renderStatus();

    fireEvent.click(screen.getByRole("button", { name: "Retry status" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(startImport).not.toHaveBeenCalled();
  });
});