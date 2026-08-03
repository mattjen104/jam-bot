// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuidedReplayPanel } from "../src/components/GuidedReplayPanel";

afterEach(cleanup);

const entries = [
  {
    position: 0,
    spinId: 1,
    playedAt: "2026-07-02T10:00:00Z",
    source: null,
    citation: null,
    rawArtist: "A",
    rawTitle: "One",
    confidence: "text",
    recording: {
      mbid: "one",
      title: "One",
      artist: "A",
      artistMbid: null,
      artworkUrl: null,
      links: [
        {
          name: "Bandcamp",
          url: "https://bandcamp.com/EmbeddedPlayer/track=100/size=large/",
          kind: "exact",
        },
        {
          name: "YouTube",
          url: "https://www.youtube.com/watch?v=one123",
          kind: "exact",
        },
      ],
      genres: null,
    },
  },
  {
    position: 1,
    spinId: 2,
    playedAt: "2026-07-02T10:03:00Z",
    source: null,
    citation: null,
    rawArtist: "B",
    rawTitle: "Two",
    confidence: "text",
    recording: {
      mbid: "two",
      title: "Two",
      artist: "B",
      artistMbid: null,
      artworkUrl: null,
      links: [
        {
          name: "YouTube",
          url: "https://youtu.be/two123",
          kind: "exact",
        },
      ],
      genres: null,
    },
  },
] as const;

describe("GuidedReplayPanel", () => {
  it("starts with Bandcamp, shows only entries with Bandcamp links, and renders the EmbeddedPlayer embed", () => {
    render(<GuidedReplayPanel entries={entries} label="KEXP · Morning" />);

    // Bandcamp mode: only position 0 has an EmbeddedPlayer URL; position 1 is YouTube-only.
    expect(screen.getByTestId("guided-coverage").textContent).toContain("1 of 2");
    fireEvent.click(screen.getByTestId("guided-start"));

    // Position 0 embeds via the official Bandcamp EmbeddedPlayer iframe.
    expect(screen.getByTestId("guided-embed").getAttribute("src")).toContain(
      "bandcamp.com/EmbeddedPlayer/track=100",
    );
    expect(screen.getByText(/does not report ended/i)).toBeTruthy();

    // Only one playable entry — Next is disabled.
    expect((screen.getByTestId("guided-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes service coverage and cleans up when the guide closes", async () => {
    render(<GuidedReplayPanel entries={entries} label="KEXP · Morning" />);

    // YouTube has links for both entries.
    fireEvent.click(screen.getByTestId("guided-service-youtube"));
    expect(screen.getByTestId("guided-coverage").textContent).toContain("2 of 2");
    fireEvent.click(screen.getByTestId("guided-start"));
    fireEvent.click(screen.getByTestId("guided-close"));
    await waitFor(() => {
      expect(screen.queryByTestId("guided-embed")).toBeNull();
    });
  });
});
