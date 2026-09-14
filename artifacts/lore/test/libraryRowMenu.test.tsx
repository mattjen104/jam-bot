// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../src/lib/meHooks";

const { mockMutate } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
}));

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useSetLibraryRemoved: () => ({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    }),
  });
});

const item = {
  mbid: "demo-track",
  spotifyId: null,
  removed: false,
  provenance: { kind: "keep" },
  recording: {
    title: "French Disko",
    artist: "Stereolab",
    artistMbid: "demo-artist",
    releaseGroupMbid: "demo-release",
  },
} as LibraryItem;

afterEach(() => {
  cleanup();
  mockMutate.mockClear();
});

describe("LibraryRowMenu", () => {
  it("keeps navigation out of the management menu", async () => {
    const { LibraryRowMenu } = await import("../src/components/LibraryRowMenu");
    render(<LibraryRowMenu item={item} />);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    expect(screen.queryByRole("button", { name: "Open album" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open artist" })).toBeNull();
    expect(screen.queryByRole("button", { name: "From the set" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove keep" })).toBeTruthy();
  });

  it("runs the remove mutation", async () => {
    const { LibraryRowMenu } = await import("../src/components/LibraryRowMenu");
    render(<LibraryRowMenu item={item} />);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove keep" }));

    expect(mockMutate).toHaveBeenCalledWith(
      { mbid: "demo-track", spotifyId: null, removed: true },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});