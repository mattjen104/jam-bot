// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MerchCollection, type MerchProduct } from "../src/components/MerchCollection";
import { normalizeMerchResponse } from "../src/lib/merch";

afterEach(() => {
  cleanup();
});

const item: MerchProduct = {
  title: "A verified shirt",
  artist: "The Canonical Artist",
  artistMbid: "artist-1",
  imageUrl: null,
  destinationUrl: "https://artist.example/store/shirt",
  source: "artist_direct",
  provider: "artist store",
  kind: "artist_direct",
};

describe("MerchCollection", () => {
  it("keeps verified products visible without artwork", () => {
    render(<MerchCollection items={[item]} />);

    expect(screen.getByTestId("merch-card")).toBeTruthy();
    expect(screen.getByTestId("merch-no-art").textContent).toContain("NO ART");
    expect(screen.getByRole("link").getAttribute("href")).toBe(item.destinationUrl);
  });

  it("renders explicit loading, error, and empty states", () => {
    const { rerender } = render(<MerchCollection items={[]} isLoading />);
    expect(screen.getByTestId("merch-loading").textContent).toContain("Loading merch");

    rerender(<MerchCollection items={[]} isError />);
    expect(screen.getByTestId("merch-error").textContent).toContain("Couldn't load merch");

    rerender(<MerchCollection items={[]} emptyMessage="No artist merch yet." />);
    expect(screen.getByTestId("merch-empty").textContent).toContain("No artist merch yet.");
  });
});

describe("normalizeMerchResponse", () => {
  it("preserves canonical identity and image-less products", () => {
    const response = normalizeMerchResponse({
      items: [{
        ...item,
        imageUrl: null,
        artistMbid: "artist-1",
      }],
      total: 1,
    });

    expect(response.items).toEqual([item]);
    expect(response.items[0]?.artistMbid).toBe("artist-1");
    expect(response.items[0]?.imageUrl).toBeNull();
  });

  it("does not invent products from incomplete response rows", () => {
    expect(normalizeMerchResponse({
      items: [
        { title: "Missing destination", artist: "Artist" },
        { title: "Missing artist", destinationUrl: "https://shop.example/item" },
      ],
    }).items).toEqual([]);
  });
});