// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuidedReplayPanel } from "../src/components/GuidedReplayPanel";
import {
  GUIDED_SERVICE_OPTIONS,
  type GuidedService,
  type GuidedServiceOption,
} from "../src/lib/guidedReplay";

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

  it("renders guided-embed (not guided-external-link) for a service with a non-null embedUrl", () => {
    // YouTube has an embedUrlBuilder and the watch URL resolves to an embed URL.
    // Select YouTube so both entries are playable; enter guided mode on the first.
    render(<GuidedReplayPanel entries={entries} label="KEXP · Morning" />);
    fireEvent.click(screen.getByTestId("guided-service-youtube"));
    fireEvent.click(screen.getByTestId("guided-start"));

    expect(screen.getByTestId("guided-embed")).toBeTruthy();
    expect(screen.queryByTestId("guided-external-link")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Synthetic embed service: verify a brand-new service added only to
// GUIDED_SERVICE_OPTIONS (with an embedUrlBuilder) automatically renders
// an iframe in the panel — no second code change required.
// ---------------------------------------------------------------------------
describe("GuidedReplayPanel — synthetic embed service auto-iframe", () => {
  const SYNTHETIC_KEY = "synthstream" as GuidedService;

  const syntheticOption: GuidedServiceOption = {
    service: SYNTHETIC_KEY,
    label: "Synth Stream",
    embedUrlBuilder: (url) =>
      /^https:\/\/synthstream\.example\/embed\/\d+$/.test(url) ? url : null,
  };

  // Entries whose only link is the synthetic service.
  const synthEntries = [
    {
      position: 0,
      spinId: 10,
      playedAt: "2026-07-02T10:00:00Z",
      source: null,
      citation: null,
      rawArtist: "Synth Artist",
      rawTitle: "Synth Track",
      confidence: "text",
      recording: {
        mbid: "synth-1",
        title: "Synth Track",
        artist: "Synth Artist",
        artistMbid: null,
        artworkUrl: null,
        links: [
          {
            name: "synthstream",
            url: "https://synthstream.example/embed/99",
            kind: "exact",
          },
        ],
        genres: null,
      },
      guidedLinks: [],
    },
  ] as const;

  beforeEach(() => {
    (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).push(syntheticOption);
    // Pre-select the synthetic service so the panel opens on it.
    localStorage.setItem("lore:guided-replay-service", SYNTHETIC_KEY);
  });

  afterEach(() => {
    const idx = (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).indexOf(syntheticOption);
    if (idx >= 0) (GUIDED_SERVICE_OPTIONS as GuidedServiceOption[]).splice(idx, 1);
    localStorage.removeItem("lore:guided-replay-service");
    cleanup();
  });

  it("shows 1 of 1 coverage for the synthetic service", () => {
    render(<GuidedReplayPanel entries={synthEntries} label="Test · Show" />);
    expect(screen.getByTestId("guided-coverage").textContent).toContain("1 of 1");
  });

  it("renders guided-embed iframe — not guided-external-link — for the synthetic embed service", () => {
    render(<GuidedReplayPanel entries={synthEntries} label="Test · Show" />);
    fireEvent.click(screen.getByTestId("guided-start"));

    const iframe = screen.getByTestId("guided-embed") as HTMLIFrameElement;
    expect(iframe.getAttribute("src")).toBe("https://synthstream.example/embed/99");
    expect(screen.queryByTestId("guided-external-link")).toBeNull();
  });
});
