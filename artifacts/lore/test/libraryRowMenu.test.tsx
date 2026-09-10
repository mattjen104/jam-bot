// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem } from "../src/lib/meHooks";

const { mockMutate, mockNavigate } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/library", mockNavigate],
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

vi.mock("../src/components/SetContextSheet", () => ({
  SetContextSheet: () => null,
}));

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
  mockNavigate.mockClear();
});

describe("LibraryRowMenu", () => {
  it("opens and runs its artist action", async () => {
    const onArtistFocus = vi.fn();
    const { LibraryRowMenu } = await import("../src/components/LibraryRowMenu");
    render(<LibraryRowMenu item={item} onArtistFocus={onArtistFocus} />);

    fireEvent.click(screen.getByRole("button", { name: "More options" }));

    expect(screen.getByRole("button", { name: "Open album" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open artist" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove keep" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open artist" }));
    expect(onArtistFocus).toHaveBeenCalledWith("Stereolab");
    expect(screen.queryByRole("button", { name: "Open artist" })).toBeNull();
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