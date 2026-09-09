// @vitest-environment jsdom
/**
 * SetContextDeck — the peek-a-set cover on Library crate rows.
 *
 * Covers:
 *   1. Only the kept cover renders initially; neighbors stay hidden behind
 *      chevrons and swipes.
 *   2. Chevrons walk before ← anchor → after and clamp at the ends.
 *   3. Horizontal swipes peek; taps and vertical scrolls do not.
 *   4. The visible cover toggles its inline preview by MBID.
 *   5. Missing neighbors stay reachable and render an honest empty slot.
 *   6. Tracks without an MBID render their cover but are not playable.
 *   7. Peeks are reported to the host so its copy column can name the song.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toggleMock = vi.fn<(mbid: string) => Promise<"playing" | "unavailable">>(() => Promise.resolve("playing"));
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

function swipe(el: HTMLElement, dx: number, dy = 0) {
  fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 120 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 120 + dy }] });
}

beforeEach(() => {
  toggleMock.mockClear();
  mockState.playingMbid = null;
  mockState.loadingMbid = null;
});

afterEach(() => cleanup());

describe("SetContextDeck", () => {
  it("renders only the kept cover until the listener peeks", () => {
    const onSelectionChange = vi.fn();
    render(<SetContextDeck context={context()} onSelectionChange={onSelectionChange} />);
    expect(screen.getByTestId("set-context-deck")).toBeTruthy();
    expect(screen.getByTestId("set-context-play-anchor").getAttribute("aria-label")).toContain(
      "Anchor Song",
    );
    expect(screen.queryByTestId("set-context-play-before")).toBeNull();
    expect(screen.queryByTestId("set-context-play-after")).toBeNull();
    // Both neighbors exist, so both chevrons are enabled.
    expect(screen.getByTestId("set-context-prev").getAttribute("disabled")).toBeNull();
    expect(screen.getByTestId("set-context-next").getAttribute("disabled")).toBeNull();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("chevrons reveal the before/after covers and clamp at the ends", () => {
    const onSelectionChange = vi.fn();
    render(<SetContextDeck context={context()} onSelectionChange={onSelectionChange} />);
    const next = screen.getByTestId("set-context-next");
    const prev = screen.getByTestId("set-context-prev");

    fireEvent.click(next);
    expect(screen.queryByTestId("set-context-play-anchor")).toBeNull();
    expect(screen.getByTestId("set-context-play-after").getAttribute("aria-label")).toContain(
      "After Song",
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith("After Song — After Artist", "after");
    // At the last slot, "next" is disabled and does nothing.
    expect(next.getAttribute("disabled")).not.toBeNull();
    fireEvent.click(next);
    expect(screen.getByTestId("set-context-play-after")).toBeTruthy();

    fireEvent.click(prev);
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
    expect(onSelectionChange).toHaveBeenLastCalledWith(null, "anchor");

    fireEvent.click(prev);
    expect(screen.getByTestId("set-context-play-before").getAttribute("aria-label")).toContain(
      "Before Song",
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith("Before Song — Before Artist", "before");
    expect(prev.getAttribute("disabled")).not.toBeNull();
  });

  it("horizontal swipes peek; short or vertical gestures do not", () => {
    render(<SetContextDeck context={context()} />);
    const deck = screen.getByTestId("set-context-deck");

    // Swipe left → the song played after the keep.
    swipe(deck, -80);
    expect(screen.getByTestId("set-context-play-after")).toBeTruthy();

    // Swipe right → back to the kept track.
    swipe(deck, 80);
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();

    // A sloppy tap (short drag) is not a swipe.
    swipe(deck, -20);
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();

    // A vertical-dominant gesture is a page scroll, not a peek.
    swipe(deck, -60, -120);
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();

    // Swipe right → the song played before the keep.
    swipe(deck, 80);
    expect(screen.getByTestId("set-context-play-before")).toBeTruthy();
    // Clamped at the first slot: another right swipe stays put.
    swipe(deck, 80);
    expect(screen.getByTestId("set-context-play-before")).toBeTruthy();
  });

  it("clicking the visible cover toggles the inline preview for that track's MBID", () => {
    render(<SetContextDeck context={context()} />);
    fireEvent.click(screen.getByTestId("set-context-play-anchor"));
    expect(toggleMock).toHaveBeenCalledWith("m-anchor");
    fireEvent.click(screen.getByTestId("set-context-next"));
    fireEvent.click(screen.getByTestId("set-context-play-after"));
    expect(toggleMock).toHaveBeenCalledWith("m-after");
    expect(toggleMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a missing neighbor reachable as an honest empty slot", () => {
    const onSelectionChange = vi.fn();
    render(<SetContextDeck context={context({ before: null })} onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByTestId("set-context-prev"));
    const slot = screen.getByTestId("set-context-cover-before");
    expect(slot.getAttribute("data-empty")).toBe("true");
    expect(slot.tagName).not.toBe("BUTTON");
    expect(screen.queryByTestId("set-context-play-before")).toBeNull();
    expect(onSelectionChange).toHaveBeenLastCalledWith("Nothing before in this set", "before");
    // The kept cover is one chevron back.
    fireEvent.click(screen.getByTestId("set-context-next"));
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
  });

  it("renders an unresolved track's cover as visible but not playable", () => {
    const onSelectionChange = vi.fn();
    render(
      <SetContextDeck
        context={context({ after: track({ spinId: 9, mbid: null, title: "Mystery", artist: "DJ" }) })}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByTestId("set-context-next"));
    expect(screen.queryByTestId("set-context-play-after")).toBeNull();
    const slot = screen.getByTestId("set-context-cover-after");
    expect(slot.getAttribute("title")).toContain("Mystery");
    fireEvent.click(slot);
    expect(toggleMock).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenLastCalledWith("Mystery — DJ", "after");
  });

  it("labels artist-fallback contexts as the latest set, not the kept broadcast", () => {
    const { rerender } = render(<SetContextDeck context={context()} />);
    expect(screen.queryByTestId("set-context-note")).toBeNull();
    rerender(<SetContextDeck context={context({ anchorKind: "artist-fallback" })} />);
    expect(screen.getByTestId("set-context-note").textContent).toBe("latest set");
  });

  it("marks the visible cover as playing via aria-pressed", () => {
    mockState.playingMbid = "m-anchor";
    render(<SetContextDeck context={context()} />);
    expect(screen.getByTestId("set-context-play-anchor").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the anchor and both chevrons immediately while context loads", () => {
    const anchor = context().anchor;
    render(<SetContextDeck pendingAnchor={anchor} />);

    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
    expect(screen.getByTestId("set-context-prev").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("set-context-next").hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("set-context-prev").getAttribute("aria-label")).toBe(
      "Loading the earlier song in this set",
    );
  });

  it("names each chevron's destination, including the way back to the kept track", () => {
    render(<SetContextDeck context={context()} />);
    expect(screen.getByTestId("set-context-prev").getAttribute("aria-label")).toBe(
      "Show the song played before: Before Song — Before Artist",
    );
    fireEvent.click(screen.getByTestId("set-context-prev"));
    expect(screen.getByTestId("set-context-next").getAttribute("aria-label")).toBe(
      "Back to the kept track: Anchor Song — Anchor Artist",
    );
  });

  it("does not leak a failed preview's state onto the next cover", async () => {
    toggleMock.mockResolvedValueOnce("unavailable");
    render(<SetContextDeck context={context()} />);
    fireEvent.click(screen.getByTestId("set-context-play-anchor"));
    await waitFor(() =>
      expect(screen.getByTestId("set-context-play-anchor").getAttribute("title")).toContain(
        "no preview available",
      ),
    );
    fireEvent.click(screen.getByTestId("set-context-next"));
    expect(screen.getByTestId("set-context-play-after").getAttribute("title")).not.toContain(
      "no preview available",
    );
  });

  it("ignores cancelled or multi-touch gestures", () => {
    render(<SetContextDeck context={context()} />);
    const deck = screen.getByTestId("set-context-deck");
    // A cancelled touch (e.g. the OS grabbed the gesture) never navigates.
    fireEvent.touchStart(deck, { touches: [{ clientX: 200, clientY: 120 }] });
    fireEvent.touchCancel(deck);
    fireEvent.touchEnd(deck, { changedTouches: [{ clientX: 100, clientY: 120 }] });
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
    // Two fingers down is a pinch, not a peek.
    fireEvent.touchStart(deck, {
      touches: [
        { clientX: 200, clientY: 120 },
        { clientX: 220, clientY: 140 },
      ],
    });
    fireEvent.touchEnd(deck, { changedTouches: [{ clientX: 100, clientY: 120 }] });
    expect(screen.getByTestId("set-context-play-anchor")).toBeTruthy();
  });
});
