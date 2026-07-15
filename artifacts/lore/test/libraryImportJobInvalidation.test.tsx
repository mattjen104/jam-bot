// @vitest-environment jsdom
/**
 * Hook-level integration test for the query-invalidation fix in Task 340.
 *
 * Confirms that useLatestImportJob picks up a new running job immediately after
 * queryClient.invalidateQueries is called — even when the previous cached
 * status was "done" (which would have caused refetchInterval to return false
 * and stopped all automatic polling).
 *
 * This lives in its own file because the sibling libraryImportBanner.test.tsx
 * has a module-level vi.mock("../src/lib/meHooks") for the Library page timer
 * tests, which would shadow the real useLatestImportJob needed here.
 */
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLatestImportJob, type ImportJobStatus } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLatestImportJob — invalidation unblocks stale 'done' cache", () => {
  it("picks up a new running job after invalidateQueries even when previous cache was 'done'", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const runningJob: ImportJobStatus = {
      jobId: 2,
      service: "spotify",
      status: "running",
      phase: "fetching",
      total: 0,
      resolved: 0,
      startedAt: "2026-07-15T10:05:00Z",
      finishedAt: null,
      error: null,
    };

    let fetchCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/api/me/library/import")) {
        fetchCount++;
        if (fetchCount === 1) {
          return new Response(
            JSON.stringify({
              jobId: 1,
              service: "spotify",
              status: "done",
              phase: null,
              total: 100,
              resolved: 100,
              startedAt: "2026-07-15T10:00:00Z",
              finishedAt: "2026-07-15T10:01:00Z",
              error: null,
            } satisfies ImportJobStatus),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify(runningJob), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useLatestImportJob(), { wrapper });

    // Wait for the initial fetch to settle on the previous "done" job.
    // At this point refetchInterval returns false — no further polling.
    await waitFor(() => {
      expect(result.current.data?.status).toBe("done");
    });

    // Simulate what handleImport (Library.tsx) and the ?import=1 useEffect
    // (TasteMap.tsx) now do after postStartImport resolves.
    await queryClient.invalidateQueries({ queryKey: ["me", "import-job", "latest"] });

    // The hook must immediately re-fetch and surface the new running job,
    // not stay stuck on the stale "done" cache.
    await waitFor(() => {
      expect(result.current.data?.jobId).toBe(2);
      expect(result.current.data?.status).toBe("running");
    });
  });
});
