// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMyLibrary = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  ApiError: class ApiError extends Error {},
  createListen: vi.fn(),
  deleteAllListens: vi.fn(),
  deleteListen: vi.fn(),
  getKeepStatus: vi.fn(),
  getPendingKeepStatus: vi.fn(),
  getListStationsNowPlayingQueryKey: vi.fn(),
  keepRecording: vi.fn(),
  listMyLibrary,
  updateListen: vi.fn(),
  unkeepRecording: vi.fn(),
  unkeepSpin: vi.fn(),
  getMyPress: vi.fn(),
  getMySavedPress: vi.fn(),
  savePressArticle: vi.fn(),
  unsavePressArticle: vi.fn(),
  getMyPressPublication: vi.fn(),
  getMyPressPublications: vi.fn(),
}));

vi.mock("../src/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import { useMyLibraryInfinite } from "../src/lib/meHooks";
import { writeLibrarySnapshot } from "../src/lib/librarySnapshot";

describe("useMyLibraryInfinite cached first page", () => {
  beforeEach(() => {
    window.localStorage.clear();
    listMyLibrary.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("refreshes immediately when the cached first page is empty", async () => {
    writeLibrarySnapshot(
      [100, "", "added", "", "", "", ""],
      { items: [], nextCursor: null, total: 0, keepCount: 0 },
    );
    listMyLibrary.mockResolvedValue({
      items: [{ mbid: "recording-1", addedAt: "2026-09-14T00:00:00.000Z" }],
      nextCursor: null,
      total: 1,
      keepCount: 1,
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useMyLibraryInfinite({}, 100),
      { wrapper },
    );

    expect(result.current.data?.pages[0]?.total).toBe(0);
    await waitFor(() => expect(listMyLibrary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data?.pages[0]?.total).toBe(1));
  });
});