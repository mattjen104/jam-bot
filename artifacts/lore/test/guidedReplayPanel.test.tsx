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
  it("shows the three doors, offers a known album at track one, and keeps Bandcamp manual", () => {
    const officialEntries = [{
      ...entries[0],
      embedFacts: [{
        provider: "bandcamp",
        role: "provenance",
        rung: 1,
        outcome: "embedded",
        confidence: "exact",
        sourceUrl: "https://artist.bandcamp.com/album/release",
        embedUrl: "https://bandcamp.com/EmbeddedPlayer/track=100/size=large/",
        albumEmbedUrl: "https://bandcamp.com/EmbeddedPlayer/album=200/size=large/",
        releaseMbid: "release",
        providerReleaseId: "200",
        providerTrackId: "100",
      }],
    }, entries[1]];
    render(
      <GuidedReplayPanel
        entries={officialEntries}
        label="KEXP · Morning"
        broadcastHref="/archive/stations/kexp"
      />,
    );

    expect(screen.getByTestId("guided-door-broadcast").getAttribute("href")).toBe("/archive/stations/kexp");
    fireEvent.click(screen.getByTestId("guided-door-album"));
    expect(screen.getByTestId("guided-embed").getAttribute("src")).toContain("album=200");
    expect(screen.getByText(/starts at track one/i)).toBeTruthy();
    expect(screen.getByText(/does not report ended/i)).toBeTruthy();
  });

  it("shows an honest no-linkable-release state without a fake player", () => {
    const noLinkEntries = [{
      ...entries[0],
      embedFacts: [{
        provider: "youtube",
        role: "control",
        rung: 6,
        outcome: "no_link",
        confidence: "none",
        sourceUrl: null,
        embedUrl: null,
        albumEmbedUrl: null,
        releaseMbid: null,
        providerReleaseId: null,
        providerTrackId: null,
      }],
      recording: { ...entries[0].recording, links: [] },
    }];
    render(<GuidedReplayPanel entries={noLinkEntries} label="KEXP · Morning" />);

    expect(screen.getByText("No linkable release found.")).toBeTruthy();
    expect((screen.getByTestId("guided-door-current") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("guided-embed")).toBeNull();
  });

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

  it("shows 'Use Next' hint — not 'advances automatically' — for a synthetic embed service without embedAutoAdvance", () => {
    render(<GuidedReplayPanel entries={synthEntries} label="Test · Show" />);
    fireEvent.click(screen.getByTestId("guided-start"));

    // The synthetic service has no embedAutoAdvance, so autoAdvance is false on its source.
    // The panel must show the "does not report ended" hint, not the YouTube auto-advance copy.
    expect(screen.getByText(/does not report ended/i)).toBeTruthy();
    expect(screen.queryByText(/advances automatically/i)).toBeNull();
  });

  it("does not auto-advance when a YouTube-origin postMessage arrives while the synthetic embed service is active", () => {
    // The postMessage listener in GuidedReplayPanel is gated on
    // current.source.service === "youtube". A synthetic service without
    // embedAutoAdvance must never be wired to that listener, so a YouTube ENDED
    // message must leave the player exactly where it started.
    render(<GuidedReplayPanel entries={synthEntries} label="Test · Show" />);
    fireEvent.click(screen.getByTestId("guided-start"));

    // Single-entry guide: Next button is disabled.
    expect((screen.getByTestId("guided-next") as HTMLButtonElement).disabled).toBe(true);

    // Simulate the exact postMessage payload YouTube sends when a video ends.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://www.youtube.com",
        data: JSON.stringify({ event: "onStateChange", info: 0 }),
      }),
    );

    // Next is still disabled — the player did not move.
    expect((screen.getByTestId("guided-next") as HTMLButtonElement).disabled).toBe(true);
    // The "Use Next" hint is still visible — the synthetic service did not advance.
    expect(screen.getByText(/does not report ended/i)).toBeTruthy();
  });
});
