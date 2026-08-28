// @vitest-environment jsdom
/**
 * PressFeedLane — the Press lens feed rendering.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PressFeedLane } from "../src/components/dial/PressFeedLane";
import type { PressArticle } from "@workspace/api-client-react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ARTICLE: PressArticle = {
  id: 1,
  title: "A great review",
  url: "https://example.com/review",
  guid: "test-guid",
  author: "Test Author",
  imageUrl: "https://example.com/review.jpg",
  excerpt: "A short feed-provided excerpt.",
  publishedAt: "2023-01-01T00:00:00.000Z",
  tags: ["Review"],
  matchedArtist: "Fleetwood Mac",
  matchedWork: "Rumours",
  pickerId: 10,
  publication: "Pitchfork",
  handle: "pitchfork",
  overlap: true,
  saved: false,
  savedAt: null,
};

function renderLane(overrides: Partial<React.ComponentProps<typeof PressFeedLane>> = {}) {
  const props: React.ComponentProps<typeof PressFeedLane> = {
    items: [ARTICLE],
    isLoading: false,
    isFailed: false,
    hasTaste: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    onLoadMore: vi.fn(),
    onArtistClick: vi.fn(),
    ...overrides,
  };

  const queryClient = new QueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PressFeedLane {...props} />
    </QueryClientProvider>
  );
  return { ...utils, props };
}

describe("PressFeedLane rows", () => {
  it("renders an article", () => {
    const { container } = renderLane();
    const link = screen.getByTestId("press-link-1");
    expect(link.getAttribute("href")).toBe("https://example.com/review");
    expect(link.textContent).toContain("A great review");
    expect(container.textContent).toContain("Fleetwood Mac");
    expect(container.textContent).toContain("By Test Author");
    expect(container.textContent).toContain("A short feed-provided excerpt.");
    expect(screen.getByTestId("press-image-1").getAttribute("src")).toBe(
      "https://example.com/review.jpg",
    );
  });

  it("falls back safely when an article image fails", () => {
    renderLane();
    fireEvent.error(screen.getByTestId("press-image-1"));
    expect(screen.getByTestId("press-image-fallback-1").textContent).toBe("P");
  });

  it("handles empty states correctly", () => {
    const { container } = renderLane({ items: [], isFailed: true });
    expect(container.textContent).toContain("couldn't check the press");
  });

  it("keeps a pagination sentinel available after an overlap-only page", () => {
    const items = Array.from({ length: 31 }, (_, index) => ({
      ...ARTICLE,
      id: index + 1,
      title: `Overlap article ${index + 1}`,
      overlap: true,
    }));
    const { container } = renderLane({
      items,
      hasNextPage: true,
    });
    expect(container.querySelector(".dial-feed-sentinel")).toBeTruthy();
    expect(screen.getByText("Overlap article 31")).toBeTruthy();
  });
});
