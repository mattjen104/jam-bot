// @vitest-environment jsdom
/**
 * PressFeedLane — the Press lens feed rendering.
 *
 * Covers:
 *  1. Mention rows render through the fdrow anatomy with the Press sentence.
 *  2. Source link is reachable (external anchor) and artist click navigates.
 *  3. Empty states are settled-gated: computing shows in-progress copy,
 *     failed shows error copy, and only a settled empty result shows
 *     "no press yet". No taste renders nothing (caller owns the nudge).
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { PressFeedLane } from "../src/components/dial/PressFeedLane";
import type { PressMentionItem } from "../src/lib/meHooks";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const MENTION: PressMentionItem = {
  id: "list:1",
  artistName: "Fleetwood Mac",
  kind: "list_entry",
  sourceLabel: "Pitchfork — Best Albums of 1977",
  context: "#3 on Best Albums of 1977 — Rumours",
  sourceUrl: "https://pitchfork.com/features/lists/1977/",
  occurredAt: "2023-01-01T00:00:00.000Z",
};

function renderLane(overrides: Partial<React.ComponentProps<typeof PressFeedLane>> = {}) {
  const props: React.ComponentProps<typeof PressFeedLane> = {
    items: [MENTION],
    isLoading: false,
    isFailed: false,
    hasTaste: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    onArtistClick: vi.fn(),
    ...overrides,
  };
  const utils = render(<PressFeedLane {...props} />);
  return { ...utils, props };
}

describe("PressFeedLane rows", () => {
  it("renders a mention through the fdrow anatomy with the Press sentence", () => {
    const { container } = renderLane();
    const row = container.querySelector(".fdrow");
    expect(row).toBeTruthy();
    expect(row?.getAttribute("data-press-kind")).toBe("list_entry");
    expect(row?.textContent).toContain("Fleetwood Mac, from your Stack, made Pitchfork — Best Albums of 1977 in 2023.");
  });

  it("the source link is a real external anchor", () => {
    renderLane();
    const link = screen.getByRole("link", { name: /Pitchfork/ });
    expect(link.getAttribute("href")).toBe("https://pitchfork.com/features/lists/1977/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("clicking the sentence navigates to the artist", () => {
    const { props } = renderLane();
    fireEvent.click(screen.getByRole("button", { name: "Open Fleetwood Mac" }));
    expect(props.onArtistClick).toHaveBeenCalledWith("Fleetwood Mac");
  });

  it("skips mentions without an artist (no subject, no sentence)", () => {
    const { container } = renderLane({
      items: [{ ...MENTION, id: "claim:9", artistName: null }],
    });
    expect(container.querySelector(".fdrow")).toBeNull();
    // With every row skipped and none renderable, the settled empty state shows.
  });
});

describe("PressFeedLane empty states (settled-gated)", () => {
  it("renders nothing when the listener has no taste — the caller owns the nudge", () => {
    const { container } = renderLane({ items: [], hasTaste: false });
    expect(container.innerHTML).toBe("");
  });

  it("shows in-progress copy while loading, never the empty state", () => {
    const { container } = renderLane({ items: [], isLoading: true });
    expect(container.textContent).toContain("Checking the press for your artists");
    expect(container.textContent).not.toContain("No press for your artists yet");
  });

  it("shows error copy when the compute failed, never the empty state", () => {
    const { container } = renderLane({ items: [], isFailed: true });
    expect(container.textContent).toContain("couldn't check the press");
    expect(container.textContent).not.toContain("No press for your artists yet");
  });

  it("shows 'no press yet' ONLY when settled: not loading, not failed", () => {
    const { container } = renderLane({ items: [] });
    expect(container.textContent).toContain("No press for your artists yet");
  });

  it("failed with existing items keeps showing the items", () => {
    const { container } = renderLane({ isFailed: true });
    expect(container.querySelector(".fdrow")).toBeTruthy();
    expect(container.textContent).not.toContain("couldn't check the press");
  });
});

describe("PressFeedLane ordering & pagination", () => {
  it("renders rows in the order given (newest-first comes from the server)", () => {
    const items: PressMentionItem[] = [
      { ...MENTION, id: "pick:2", artistName: "Big Thief", occurredAt: "2026-08-10T00:00:00.000Z", kind: "pick", sourceLabel: "Bandcamp Daily" },
      { ...MENTION, id: "list:1" },
    ];
    const { container } = renderLane({ items });
    const rows = [...container.querySelectorAll(".fdrow")];
    expect(rows[0]?.textContent).toContain("Big Thief");
    expect(rows[1]?.textContent).toContain("Fleetwood Mac");
  });

  it("without IntersectionObserver (jsdom) all items render and a More button covers the next page", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...MENTION,
      id: `list:${i}`,
      artistName: `Artist ${i}`,
    }));
    const { container, props } = renderLane({ items: many, hasNextPage: true });
    expect(container.querySelectorAll(".fdrow")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(props.onLoadMore).toHaveBeenCalled();
  });
});
