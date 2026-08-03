// @vitest-environment jsdom
/**
 * Focused contract test: ReplayEntry from the generated API schema must carry
 * embedFacts so that GuidedReplayPanel can resolve official-replay doors.
 *
 * If a future codegen run drops embedFacts from ReplayEntry this file will fail
 * to typecheck — the intent is to catch that regression before release.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReplayEntry } from "@workspace/api-client-react";
import { GuidedReplayPanel } from "../src/components/GuidedReplayPanel";

afterEach(cleanup);

/**
 * A fully-typed ReplayEntry with embedFacts populated.
 * TypeScript will error here if embedFacts is ever removed from the generated type.
 */
const typedEntry: ReplayEntry = {
  position: 0,
  spinId: 1,
  playedAt: "2026-07-02T10:00:00Z",
  source: null,
  citation: null,
  rawArtist: "Fleetwood Mac",
  rawTitle: "Go Your Own Way",
  confidence: "recording_id",
  recording: {
    mbid: "abc-123",
    title: "Go Your Own Way",
    artist: "Fleetwood Mac",
    artistMbid: "fleetwood-mbid",
    artworkUrl: null,
    links: [
      {
        name: "Bandcamp",
        url: "https://bandcamp.com/EmbeddedPlayer/track=999/size=large/",
        kind: "exact",
      },
    ],
    genres: null,
  },
  guidedLinks: [],
  // This field must exist on ReplayEntry — the test fails to compile if it is removed.
  embedFacts: [
    {
      provider: "bandcamp",
      role: "provenance",
      rung: 1,
      outcome: "embedded",
      confidence: "exact",
      sourceUrl: "https://fleetwood.bandcamp.com/album/rumours",
      embedUrl: "https://bandcamp.com/EmbeddedPlayer/track=999/size=large/",
      albumEmbedUrl: "https://bandcamp.com/EmbeddedPlayer/album=42/size=large/",
      releaseMbid: "rumours-release",
      providerReleaseId: "42",
      providerTrackId: "999",
    },
  ],
};

describe("ReplayEntry generated-type contract — embedFacts", () => {
  it("ReplayEntry carries embedFacts and the panel resolves the album door from it", () => {
    render(
      <GuidedReplayPanel
        entries={[typedEntry]}
        label="KEXP · Morning"
        broadcastHref="/archive/stations/kexp"
      />,
    );

    // The album door must be enabled when embedFacts contains an albumEmbedUrl.
    const albumDoor = screen.getByTestId("guided-door-album") as HTMLButtonElement;
    expect(albumDoor.disabled).toBe(false);

    // Clicking the album door opens the album embed, confirming the panel
    // consumed embedFacts correctly.
    fireEvent.click(albumDoor);
    const embed = screen.getByTestId("guided-embed") as HTMLIFrameElement;
    expect(embed.getAttribute("src")).toContain("album=42");
  });

  it("panel shows the honest no-link status when embedFacts reports no_link", () => {
    const noLinkEntry: ReplayEntry = {
      ...typedEntry,
      recording: { ...typedEntry.recording!, links: [] },
      embedFacts: [
        {
          provider: "bandcamp",
          role: "provenance",
          rung: 1,
          outcome: "no_link",
          confidence: "none",
          sourceUrl: null,
          embedUrl: null,
          albumEmbedUrl: null,
          releaseMbid: null,
          providerReleaseId: null,
          providerTrackId: null,
        },
      ],
    };

    render(<GuidedReplayPanel entries={[noLinkEntry]} label="KEXP · Morning" />);

    const currentDoor = screen.getByTestId("guided-door-current") as HTMLButtonElement;
    expect(currentDoor.disabled).toBe(true);
    // officialEmbedStatus text for no_link outcome
    expect(screen.getByText("No linkable release found.")).toBeTruthy();
  });
});
