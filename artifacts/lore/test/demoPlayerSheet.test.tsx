import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoPlayerSheet } from "../src/components/DemoPlayerSheet";
import { PlayerProvider } from "../src/player/PlayerProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

describe("DemoPlayerSheet", () => {
  it("renders correctly in demo mode", async () => {
    // Basic test that DemoPlayerSheet is wired up
    const queryClient = new QueryClient();
    const station = {
      id: 1,
      slug: "kexp",
      name: "KEXP",
      homepageUrl: "https://kexp.org",
      streamUrl: "https://kexp.stream.org",
      streamFormat: "mp3",
      hidden: false,
      org: "KEXP",
      city: "Seattle",
      country: "US",
    };
    
    render(
      <QueryClientProvider client={queryClient}>
        <Router>
          <PlayerProvider>
            <DemoPlayerSheet 
              station={station}
              nowPlayingData={{
                station,
                nowPlaying: {
                  spinId: 100,
                  rawArtist: "Tamar Aphek",
                  rawTitle: "Pale Horse",
                  playedAt: "2023-01-01T12:00:00Z",
                  confidence: "high",
                  timestampKind: "exact",
                  timingReason: "receipt_only",
                  recording: {
                    mbid: "mbid-1",
                    artist: "Tamar Aphek",
                    title: "Pale Horse",
                    artistMbid: "artist-1",
                    links: [],
                    artworkUrl: "http://example.com/art.jpg"
                  },
                  show: {
                    name: "Afternoon Show",
                    djName: "Cheryl Waters"
                  }
                }
              }}
              status="playing"
              onToggle={() => {}}
              onCollapse={() => {}}
            />
          </PlayerProvider>
        </Router>
      </QueryClientProvider>
    );

    expect(screen.getAllByText("Pale Horse").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tamar Aphek").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Selected by Cheryl Waters").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Afternoon Show · started 12:00 p\.?m\.?/i).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Pause").length).toBeGreaterThan(0);
  });
});
