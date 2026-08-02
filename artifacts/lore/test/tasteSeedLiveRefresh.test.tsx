// @vitest-environment jsdom

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ME_DIAL_CROSSINGS_KEY,
  ME_PICKER_NAMES_KEY,
  useSetTasteSeeds,
} from "../src/lib/meHooks";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("taste seed refreshes", () => {
  it("invalidates crossings, picker names, and the live pulse after saving", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ artists: ["Refresh Artist"] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    let mutation: ReturnType<typeof useSetTasteSeeds> | undefined;

    function Harness() {
      mutation = useSetTasteSeeds();
      return null;
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    await mutation!.mutateAsync(["Refresh Artist"]);
    const today = new Date().toISOString().slice(0, 10);

    expect(fetchMock).toHaveBeenCalledWith("/api/me/taste-seeds", expect.objectContaining({ method: "PUT" }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_DIAL_CROSSINGS_KEY(today) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_PICKER_NAMES_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/stations/now-playing"] });
  });
});