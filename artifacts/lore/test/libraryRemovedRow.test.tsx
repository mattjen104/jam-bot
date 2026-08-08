// @vitest-environment jsdom
/**
 * Library removed-state rendering & toggle contract for LibraryRow:
 *
 *   - A removed item stays in the list, gets the gray `lrow--removed` class
 *     and a visible "removed" badge, and hides the playback rail.
 *   - An active item renders no removed badge and shows a Remove control.
 *   - The Remove control calls the removal mutation with removed:true
 *     (mbid rows) — and the Restore control calls it with removed:false.
 *   - Soft (unresolved) rows toggle via spotifyId.
 *   - Nothing in the flow touches Spotify — the only network surface is the
 *     useSetLibraryRemoved mutation, which is asserted on directly.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import type { LibraryItem } from "../src/lib/meHooks";

const { mockMutate, mockUseSetLibraryRemoved } = vi.hoisted(() => {
  const mockMutate = vi.fn();
  return {
    mockMutate,
    mockUseSetLibraryRemoved: vi.fn(() => ({
      mutate: mockMutate,
      mutateAsync: vi.fn(),
      isPending: false,
      error: null,
    })),
  };
});

vi.mock("../src/lib/meHooks", async (importOriginal) => {
  const { makeMeHooksMock } = await import("./helpers/meHooksMock");
  return makeMeHooksMock(importOriginal, {
    useMyAlbumAvatar: vi.fn(() => ({ data: undefined })),
    useSetAlbumAvatar: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useSetLibraryRemoved: mockUseSetLibraryRemoved,
  });
});

vi.mock("../src/player/PlayerProvider", async (importOriginal) => {
  const { makePlayerProviderMock } = await import("./helpers/playerProviderMock");
  return makePlayerProviderMock(importOriginal, {
    usePlayer: vi.fn(() => ({ ride: { active: false }, radio: { station: null } })),
  });
});

import { LibraryRow } from "../src/components/LibraryRow";

const baseItem: LibraryItem = {
  mbid: "mbid-1",
  provenance: { kind: "keep" } as LibraryItem["provenance"],
  addedAt: "2026-08-01T00:00:00.000Z",
  recording: { mbid: "mbid-1", title: "Go Your Own Way", artist: "Fleetwood Mac" },
} as LibraryItem;

afterEach(() => {
  cleanup();
  mockMutate.mockClear();
});

describe("LibraryRow removed state", () => {
  it("renders removed rows gray, labeled, still listed, with a Restore control", () => {
    const { container } = render(
      <ul>
        <LibraryRow item={{ ...baseItem, removed: true, removedAt: "2026-08-07T00:00:00.000Z" }} />
      </ul>,
    );
    const row = container.querySelector("li.lrow");
    expect(row).toBeTruthy();
    expect(row!.className).toContain("lrow--removed");
    expect(screen.getByTestId("library-removed-badge").textContent).toContain("removed");
    expect(screen.getByText("Go Your Own Way")).toBeTruthy();
    // Playback rail hidden while removed; restore control present.
    expect(container.querySelector(".lrow__play")).toBeNull();
    expect(screen.getByTestId("library-restore")).toBeTruthy();
  });

  it("active rows show no removed badge and offer a Remove control", () => {
    const { container } = render(<ul><LibraryRow item={baseItem} /></ul>);
    expect(container.querySelector(".lrow--removed")).toBeNull();
    expect(screen.queryByTestId("library-removed-badge")).toBeNull();
    expect(screen.getByTestId("library-remove")).toBeTruthy();
  });

  it("Remove calls the mutation with removed:true; Restore with removed:false", () => {
    render(<ul><LibraryRow item={baseItem} /></ul>);
    fireEvent.click(screen.getByTestId("library-remove"));
    expect(mockMutate).toHaveBeenCalledWith({ mbid: "mbid-1", spotifyId: undefined, removed: true });

    cleanup();
    mockMutate.mockClear();
    render(<ul><LibraryRow item={{ ...baseItem, removed: true }} /></ul>);
    fireEvent.click(screen.getByTestId("library-restore"));
    expect(mockMutate).toHaveBeenCalledWith({ mbid: "mbid-1", spotifyId: undefined, removed: false });
  });

  it("soft rows toggle via spotifyId", () => {
    const softItem = {
      ...baseItem,
      mbid: null,
      recording: undefined,
      soft: true,
      spotifyId: "sp-123",
      title: "Unmatched Track",
      artist: "Someone",
    } as unknown as LibraryItem;
    render(<ul><LibraryRow item={softItem} /></ul>);
    fireEvent.click(screen.getByTestId("library-remove"));
    expect(mockMutate).toHaveBeenCalledWith({ mbid: null, spotifyId: "sp-123", removed: true });
  });
});
