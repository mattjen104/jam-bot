/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class SequenceAudio extends EventTarget {
  paused = true;
  preload = "";
  private source = "";
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  set src(value: string) { this.source = value; }
  get src() { return this.source; }
  removeAttribute(name: string) { if (name === "src") this.source = ""; }
}
vi.stubGlobal("Audio", SequenceAudio);

const { getPreviewCached, useGetAlbum } = vi.hoisted(() => ({
  getPreviewCached: vi.fn(),
  useGetAlbum: vi.fn(),
}));

vi.mock("wouter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useParams: () => ({ releaseGroupMbid: "release-group" }),
  useSearch: () => "",
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  useGetAlbum,
}));
vi.mock("../src/player/previewCache", () => ({ getPreviewCached }));
vi.mock("../src/lib/meHooks", () => ({
  useAppConfig: () => ({ data: { demoSurface: true } }),
  useMyLibraryMbids: () => ({ data: { mbids: [] } }),
}));
vi.mock("../src/components/ListProvenance", () => ({ AlbumListProvenance: () => null }));

import Album from "../src/pages/Album";
import { stopInlinePreview } from "../src/player/inlinePreview";

const track = (mbid: string, title: string) => ({
  mbid,
  title,
  artist: "Artist",
  artistMbid: "artist-id",
  artworkUrl: null,
  spinCount: 0,
  lastSpunAt: null,
});

describe("Album sequence with the real inline store", () => {
  beforeEach(() => {
    stopInlinePreview();
    getPreviewCached
      .mockResolvedValueOnce({ previewUrl: null })
      .mockResolvedValueOnce({ previewUrl: "https://example.test/second.m4a" });
    useGetAlbum.mockReturnValue({
      data: {
        releaseGroupMbid: "release-group",
        title: "Album",
        primaryType: "Album",
        releaseYear: 2026,
        tracks: [track("first", "First"), track("second", "Second")],
      },
      isLoading: false,
      isError: false,
    });
  });
  afterEach(() => {
    cleanup();
    stopInlinePreview();
    vi.clearAllMocks();
  });

  it("advances past an unavailable first clip after loading-state rerenders", async () => {
    render(<Album />);
    fireEvent.click(screen.getByRole("button", { name: "Preview Album" }));
    await waitFor(() => expect(getPreviewCached).toHaveBeenCalledTimes(2));
    expect(getPreviewCached.mock.calls.map(([mbid]) => mbid)).toEqual(["first", "second"]);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(await screen.findByText("Previewing")).toBeTruthy();
  });
});