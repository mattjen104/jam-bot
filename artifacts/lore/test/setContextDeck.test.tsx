// @vitest-environment jsdom
/**
 * SetContextDeck — the 3-cover cluster on Library crate rows.
 *
 * Covers:
 *   1. Before / anchor / after covers all render; playable tracks are buttons.
 *   2. Clicking a cover toggles its inline preview by MBID.
 *   3. Missing neighbors render honest empty slots, not buttons.
 *   4. Tracks without an MBID render their cover but are not playable.
 *   5. The playing cover reflects the shared preview state (aria-pressed).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const toggleMock = vi.fn<(mbid: string) => Promise<"playing">>(() => Promise.resolve("playing"));
const mockState = {
  playingMbid: null as string | null,
  loadingMbid: null as string | null,
};

vi.mock("../src/player/inlinePreview", () => ({
  useInlinePreview: () => ({
    playingMbid: mockState.playingMbid,
    loadingMbid: mockState.loadingMbid,
    toggle: toggleMock,
    stop: vi.fn(),
  }),
}));

import { SetContextDeck } from "../src/components/SetContextDeck";
import type { SetContext, SetContextTrack } from "../src/lib/setContexts";

function track(overrides: Partial<SetContextTrack>): SetContextTrack {
  return {
    spinId: 1,
    mbid: "m-x",
    title: "Song",
    artist: "Artist",
    albumTitle: "Album",
    artworkUrl: "https://img.example.com/cover.jpg",
    releaseGroupMbid: null,
    playedAt: "2026-09-01T20:00:00.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<SetContext> = {}): SetContext {
  return {
    station: { slug: "kexp", name: "KEXP", homepageUrl: "https://kexp.org" },
    anchorKind: "kept-spin",
    anchor: track({ spinId: 2, mbid: "m-anchor", title: "Anchor Song", artist: "Anchor Artist" }),
    before: track({ spinId: 1, mbid: "m-before", title: "Before Song", artist: "Before Artist" }),
    after: track({ spinId: 3, mbid: "m-after", title: "After Song", artist: "After Artist" }),
    ...overrides,
  };
}

beforeEach(() => {
  toggleMock.mockClear();
  mockState.playingMbid = null;
  mockState.loadingMbid = null;
});

afterEach(() => cleanup());

describe("SetContextDeck", () => {
  it("renders all three covers as preview play buttons", () => {
    render(<SetContextDeck context={context()} />);
    expect(screen.getByTestId("set-context-deck")).toBeTruthy();
    const before = screen.getByTestId("set-context-play-before");
    const anchor = screen.getByTestId("set-context-play-anchor");
    const after = screen.getByTestId("set-context-play-after");
    expect(before.getAttribute("aria-label")).toContain("Before Song");
    expect(anchor.getAttribute("aria-label")).toContain("Anchor Song");
    expect(after.getAttribute("aria-label")).toContain("After Song");
  });

  it("clicking a cover toggles the inline preview for that track's MBID", () => {
    render(<SetContextDeck context={context()} />);
    fireEvent.click(screen.getByTestId("set-context-play-before"));
    expect(toggleMock).toHaveBeenCalledWith("m-before");
    fireEvent.click(screen.getByTestId("set-context-play-anchor"));
    expect(toggleMock).toHaveBeenCalledWith("m-anchor");
    expect(toggleMock).toHaveBeenCalledTimes(2);
  });

  it("renders an honest empty slot for a missing neighbor", () => {
    render(<SetContextDeck context={context({ before: null })} />);
    const slot = screen.getByTestId("set-context-cover-before");
    expect(slot.getAttribute("data-empty")).toBe("true");
    expect(slot.tagName).not.toBe("BUTTON");
    expect(screen.queryByTestId("set-context-play-before")).toBeNull();
    // Anchor and after still render as buttons.
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
    expect(screen.getByTestId("set-context-play-after")).toBeTruthy();
  });

  it("renders an unresolved track's cover without a play button", () => {
    render(
      <SetContextDeck
        context={context({ after: track({ spinId: 9, mbid: null, title: "Mystery", artist: "DJ" }) })}
      />,
    );
    const slot = screen.getByTestId("set-context-cover-after");
    expect(slot.tagName).not.toBe("BUTTON");
    expect(slot.getAttribute("title")).toContain("Mystery");
    expect(screen.queryByTestId("set-context-play-after")).toBeNull();
  });

  it("labels artist-fallback contexts as the latest set, not the kept broadcast", () => {
    const { rerender } = render(<SetContextDeck context={context()} />);
    expect(screen.queryByTestId("set-context-note")).toBeNull();
    rerender(<SetContextDeck context={context({ anchorKind: "artist-fallback" })} />);
    expect(screen.getByTestId("set-context-note").textContent).toBe("latest set");
  });

  it("marks the playing cover via aria-pressed", () => {
    mockState.playingMbid = "m-anchor";
    render(<SetContextDeck context={context()} />);
    expect(screen.getByTestId("set-context-play-anchor").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("set-context-play-before").getAttribute("aria-pressed")).toBe("false");
  });
});
